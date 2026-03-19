import { beforeEach, describe, expect, test } from "bun:test";
import {
  instrumentCheckpoint,
  instrumentLLMCall,
  instrumentToolExecution,
} from "../../src/telemetry/instrument";
import { _resetOtelLoader, clearRecordedSpans, getRecordedSpans } from "../../src/telemetry/tracer";
import type { TelemetryConfig } from "../../src/telemetry/types";

beforeEach(() => {
  clearRecordedSpans();
  _resetOtelLoader();
});

describe("instrumentLLMCall", () => {
  test("no-op when telemetry disabled", async () => {
    const config: TelemetryConfig = { enabled: false };
    let called = false;

    const result = await instrumentLLMCall(config, "bedrock", "claude-3", async () => {
      called = true;
      return "llm-result";
    });

    expect(result).toBe("llm-result");
    expect(called).toBe(true);
    expect(getRecordedSpans()).toHaveLength(0);
  });

  test("no-op when config undefined", async () => {
    const result = await instrumentLLMCall(undefined, "bedrock", "claude-3", async () => "hello");
    expect(result).toBe("hello");
    expect(getRecordedSpans()).toHaveLength(0);
  });

  test("adds gen_ai.system attribute", async () => {
    const config: TelemetryConfig = { enabled: true };

    await instrumentLLMCall(config, "bedrock", "claude-3-sonnet", async () => "ok");

    const spans = getRecordedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("llm.call");
    expect(spans[0].attributes["gen_ai.system"]).toBe("bedrock");
  });

  test("adds gen_ai.request.model attribute", async () => {
    const config: TelemetryConfig = { enabled: true };

    await instrumentLLMCall(config, "openai", "gpt-4", async () => "ok");

    const spans = getRecordedSpans();
    expect(spans[0].attributes["gen_ai.request.model"]).toBe("gpt-4");
  });

  test("records error status on throw", async () => {
    const config: TelemetryConfig = { enabled: true };

    await expect(
      instrumentLLMCall(config, "bedrock", "claude-3", async () => {
        throw new Error("LLM failed");
      })
    ).rejects.toThrow("LLM failed");

    const spans = getRecordedSpans();
    expect(spans[0].status).toBe("error");
  });

  test("preserves original function return value", async () => {
    const config: TelemetryConfig = { enabled: true };

    const result = await instrumentLLMCall(config, "bedrock", "claude-3", async () => ({
      content: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    }));

    expect(result).toEqual({
      content: "test",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
  });
});

describe("instrumentToolExecution", () => {
  test("no-op when telemetry disabled", async () => {
    const config: TelemetryConfig = { enabled: false };
    let called = false;

    const result = await instrumentToolExecution(config, "nmap", async () => {
      called = true;
      return { ports: [80, 443] };
    });

    expect(result).toEqual({ ports: [80, 443] });
    expect(called).toBe(true);
    expect(getRecordedSpans()).toHaveLength(0);
  });

  test("no-op when config undefined", async () => {
    const result = await instrumentToolExecution(undefined, "echo", async () => "hello");
    expect(result).toBe("hello");
    expect(getRecordedSpans()).toHaveLength(0);
  });

  test("adds tool.name attribute", async () => {
    const config: TelemetryConfig = { enabled: true };

    await instrumentToolExecution(config, "gobuster", async () => "dirs found");

    const spans = getRecordedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("tool.execute");
    expect(spans[0].attributes["tool.name"]).toBe("gobuster");
  });

  test("records error status on throw", async () => {
    const config: TelemetryConfig = { enabled: true };

    await expect(
      instrumentToolExecution(config, "failing-tool", async () => {
        throw new Error("Tool failed");
      })
    ).rejects.toThrow("Tool failed");

    const spans = getRecordedSpans();
    expect(spans[0].status).toBe("error");
    expect(spans[0].attributes["tool.name"]).toBe("failing-tool");
  });

  test("preserves original function return value", async () => {
    const config: TelemetryConfig = { enabled: true };

    const result = await instrumentToolExecution(config, "nmap", async () => ({
      openPorts: [22, 80, 443],
    }));

    expect(result).toEqual({ openPorts: [22, 80, 443] });
  });

  test("works with different tool names", async () => {
    const config: TelemetryConfig = { enabled: true };

    await instrumentToolExecution(config, "httpx", async () => "ok1");
    await instrumentToolExecution(config, "nuclei", async () => "ok2");

    const spans = getRecordedSpans();
    expect(spans).toHaveLength(2);
    expect(spans[0].attributes["tool.name"]).toBe("httpx");
    expect(spans[1].attributes["tool.name"]).toBe("nuclei");
  });
});

describe("instrumentCheckpoint", () => {
  test("no-op when telemetry disabled", async () => {
    const config: TelemetryConfig = { enabled: false };
    let called = false;

    const result = await instrumentCheckpoint(config, "save", async () => {
      called = true;
      return "checkpoint-id";
    });

    expect(result).toBe("checkpoint-id");
    expect(called).toBe(true);
    expect(getRecordedSpans()).toHaveLength(0);
  });

  test("no-op when config undefined", async () => {
    const result = await instrumentCheckpoint(undefined, "load", async () => "data");
    expect(result).toBe("data");
    expect(getRecordedSpans()).toHaveLength(0);
  });

  test("creates checkpoint.save span", async () => {
    const config: TelemetryConfig = { enabled: true };

    await instrumentCheckpoint(config, "save", async () => "cp-123");

    const spans = getRecordedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("checkpoint.save");
  });

  test("creates checkpoint.load span", async () => {
    const config: TelemetryConfig = { enabled: true };

    await instrumentCheckpoint(config, "load", async () => "loaded-data");

    const spans = getRecordedSpans();
    expect(spans[0].name).toBe("checkpoint.load");
  });

  test("creates checkpoint.fork span", async () => {
    const config: TelemetryConfig = { enabled: true };

    await instrumentCheckpoint(config, "fork", async () => "forked-id");

    const spans = getRecordedSpans();
    expect(spans[0].name).toBe("checkpoint.fork");
  });

  test("records error status on throw", async () => {
    const config: TelemetryConfig = { enabled: true };

    await expect(
      instrumentCheckpoint(config, "save", async () => {
        throw new Error("Save failed");
      })
    ).rejects.toThrow("Save failed");

    const spans = getRecordedSpans();
    expect(spans[0].status).toBe("error");
  });
});

describe("no double spans", () => {
  test("instrumentLLMCall creates exactly one span", async () => {
    const config: TelemetryConfig = { enabled: true };

    await instrumentLLMCall(config, "bedrock", "claude-3", async () => "result");

    const spans = getRecordedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("llm.call");
  });

  test("instrumentToolExecution creates exactly one span", async () => {
    const config: TelemetryConfig = { enabled: true };

    await instrumentToolExecution(config, "test-tool", async () => "result");

    const spans = getRecordedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("tool.execute");
  });

  test("instrumentCheckpoint creates exactly one span", async () => {
    const config: TelemetryConfig = { enabled: true };

    await instrumentCheckpoint(config, "save", async () => "result");

    const spans = getRecordedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("checkpoint.save");
  });
});
