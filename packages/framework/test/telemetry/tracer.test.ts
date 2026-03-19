import { beforeEach, describe, expect, test } from "bun:test";
import {
  _resetOtelLoader,
  addSpanAttributes,
  clearRecordedSpans,
  getRecordedSpans,
  withSpan,
} from "../../src/telemetry/tracer";
import type { TelemetryConfig } from "../../src/telemetry/types";

beforeEach(() => {
  clearRecordedSpans();
  _resetOtelLoader();
});

describe("withSpan", () => {
  test("no-op when telemetry disabled", async () => {
    const config: TelemetryConfig = { enabled: false };
    let called = false;

    const result = await withSpan(config, "test.span", async () => {
      called = true;
      return 42;
    });

    expect(result).toBe(42);
    expect(called).toBe(true);
    expect(getRecordedSpans()).toHaveLength(0);
  });

  test("no-op when config undefined", async () => {
    const result = await withSpan(undefined, "test.span", async () => "hello");
    expect(result).toBe("hello");
    expect(getRecordedSpans()).toHaveLength(0);
  });

  test("records span when enabled (no OTel deps)", async () => {
    const config: TelemetryConfig = { enabled: true };

    const result = await withSpan(config, "agent.run", async () => "done");

    expect(result).toBe("done");
    const spans = getRecordedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("agent.run");
    expect(spans[0].status).toBe("ok");
    expect(spans[0].endCalled).toBe(true);
  });

  test("records attributes on span", async () => {
    const config: TelemetryConfig = { enabled: true };

    await withSpan(config, "llm.call", async () => "ok", {
      "gen_ai.system": "bedrock",
      "gen_ai.usage.input_tokens": 100,
      "gen_ai.usage.output_tokens": 50,
    });

    const spans = getRecordedSpans();
    expect(spans[0].attributes["gen_ai.system"]).toBe("bedrock");
    expect(spans[0].attributes["gen_ai.usage.input_tokens"]).toBe(100);
    expect(spans[0].attributes["gen_ai.usage.output_tokens"]).toBe(50);
  });

  test("skips undefined attribute values", async () => {
    const config: TelemetryConfig = { enabled: true };

    await withSpan(config, "test", async () => "ok", {
      "gen_ai.system": undefined,
      "gen_ai.usage.input_tokens": 10,
    });

    const spans = getRecordedSpans();
    expect(spans[0].attributes["gen_ai.system"]).toBeUndefined();
    expect(spans[0].attributes["gen_ai.usage.input_tokens"]).toBe(10);
  });

  test("records error status on throw", async () => {
    const config: TelemetryConfig = { enabled: true };

    await expect(
      withSpan(config, "failing.span", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    const spans = getRecordedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("error");
    expect(spans[0].endCalled).toBe(true);
  });

  test("creates parent-child hierarchy", async () => {
    const config: TelemetryConfig = { enabled: true };

    await withSpan(config, "agent.run", async () => {
      await withSpan(config, "llm.call", async () => "response");
      await withSpan(config, "tool.execute", async () => "result", {
        "tool.name": "echo",
      });
      return "done";
    });

    const spans = getRecordedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("agent.run");
    expect(spans[0].children).toHaveLength(2);
    expect(spans[0].children[0].name).toBe("llm.call");
    expect(spans[0].children[1].name).toBe("tool.execute");
    expect(spans[0].children[1].attributes["tool.name"]).toBe("echo");
  });

  test("3-level span hierarchy: agent.run → llm.call → tool.execute", async () => {
    const config: TelemetryConfig = { enabled: true, serviceName: "test-agent" };

    await withSpan(
      config,
      "agent.run",
      async () => {
        await withSpan(
          config,
          "llm.call",
          async () => {
            return "response";
          },
          { "gen_ai.system": "bedrock" }
        );

        await withSpan(
          config,
          "tool.execute",
          async () => {
            return "tool-result";
          },
          { "tool.name": "nmap" }
        );

        return "final";
      },
      { "agent.name": "scanner" }
    );

    const spans = getRecordedSpans();
    expect(spans).toHaveLength(1);

    const agentSpan = spans[0];
    expect(agentSpan.name).toBe("agent.run");
    expect(agentSpan.attributes["agent.name"]).toBe("scanner");
    expect(agentSpan.children).toHaveLength(2);

    const llmSpan = agentSpan.children[0];
    expect(llmSpan.name).toBe("llm.call");
    expect(llmSpan.attributes["gen_ai.system"]).toBe("bedrock");

    const toolSpan = agentSpan.children[1];
    expect(toolSpan.name).toBe("tool.execute");
    expect(toolSpan.attributes["tool.name"]).toBe("nmap");
  });
});

describe("addSpanAttributes", () => {
  test("adds attributes to active span", async () => {
    const config: TelemetryConfig = { enabled: true };

    await withSpan(config, "llm.call", async () => {
      addSpanAttributes(config, {
        "gen_ai.usage.input_tokens": 200,
        "gen_ai.usage.output_tokens": 100,
      });
      return "ok";
    });

    const spans = getRecordedSpans();
    expect(spans[0].attributes["gen_ai.usage.input_tokens"]).toBe(200);
    expect(spans[0].attributes["gen_ai.usage.output_tokens"]).toBe(100);
  });

  test("no-op when disabled", () => {
    addSpanAttributes({ enabled: false }, { "gen_ai.system": "test" });
    expect(getRecordedSpans()).toHaveLength(0);
  });

  test("no-op when no active span", () => {
    addSpanAttributes({ enabled: true }, { "gen_ai.system": "test" });
    expect(getRecordedSpans()).toHaveLength(0);
  });
});

describe("clearRecordedSpans", () => {
  test("clears all recorded spans", async () => {
    const config: TelemetryConfig = { enabled: true };
    await withSpan(config, "span1", async () => "ok");
    await withSpan(config, "span2", async () => "ok");
    expect(getRecordedSpans()).toHaveLength(2);

    clearRecordedSpans();
    expect(getRecordedSpans()).toHaveLength(0);
  });
});
