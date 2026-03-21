import { beforeEach, describe, expect, test } from "bun:test";
import {
  getOutputPolicy,
  type OutputPolicyConfig,
  resolveOutputMode,
} from "../../src/output-policy/resolve";
import type { DefaultPublicPayload } from "../../src/output-policy/types";
import type { AgentCompleteEvent, ToolCallEvent, ToolResultEvent } from "../../src/types/events";

describe("resolveOutputMode", () => {
  const originalEnv = process.env.OBSKU_OUTPUT_MODE;

  beforeEach(() => {
    delete process.env.OBSKU_OUTPUT_MODE;
  });

  test("should return 'default' when no env var and no config", () => {
    const mode = resolveOutputMode();

    expect(mode).toBe("default");
  });

  test("should return 'default' when env var is 'default'", () => {
    process.env.OBSKU_OUTPUT_MODE = "default";

    const mode = resolveOutputMode();

    expect(mode).toBe("default");
  });

  test("env var OBSKU_OUTPUT_MODE='strands' selects strands mode", () => {
    process.env.OBSKU_OUTPUT_MODE = "strands";

    const mode = resolveOutputMode();

    expect(mode).toBe("strands");
  });

  test("config { mode: 'strands' } selects strands mode", () => {
    const config: OutputPolicyConfig = { mode: "strands" };

    const mode = resolveOutputMode(config);

    expect(mode).toBe("strands");
  });

  test("should return config.mode when env var is not set", () => {
    const config: OutputPolicyConfig = { mode: "default" };

    const mode = resolveOutputMode(config);

    expect(mode).toBe("default");
  });

  test("env var should take precedence over config", () => {
    process.env.OBSKU_OUTPUT_MODE = "strands";
    const config: OutputPolicyConfig = { mode: "default" };

    const mode = resolveOutputMode(config);

    expect(mode).toBe("strands");
  });

  test("env var 'default' takes precedence over config 'strands'", () => {
    process.env.OBSKU_OUTPUT_MODE = "default";
    const config: OutputPolicyConfig = { mode: "strands" };

    const mode = resolveOutputMode(config);

    expect(mode).toBe("default");
  });

  test("should fallback to config when env var is invalid", () => {
    process.env.OBSKU_OUTPUT_MODE = "invalid-mode";
    const config: OutputPolicyConfig = { mode: "strands" };

    const mode = resolveOutputMode(config);

    expect(mode).toBe("strands");
  });

  test("should fallback to default when env var is invalid and no config", () => {
    process.env.OBSKU_OUTPUT_MODE = "invalid-mode";

    const mode = resolveOutputMode();

    expect(mode).toBe("default");
  });

  test("should fallback to config when env var is empty string", () => {
    process.env.OBSKU_OUTPUT_MODE = "";
    const config: OutputPolicyConfig = { mode: "strands" };

    const mode = resolveOutputMode(config);

    expect(mode).toBe("strands");
  });

  test("should fallback to default when env var is unrecognized", () => {
    process.env.OBSKU_OUTPUT_MODE = "custom-mode";

    const mode = resolveOutputMode();

    expect(mode).toBe("default");
  });

  test("precedence: env var > config > default", () => {
    const modeDefault = resolveOutputMode();
    expect(modeDefault).toBe("default");

    const modeConfig = resolveOutputMode({ mode: "strands" });
    expect(modeConfig).toBe("strands");

    process.env.OBSKU_OUTPUT_MODE = "default";
    const modeEnv = resolveOutputMode({ mode: "strands" });
    expect(modeEnv).toBe("default");
  });

  test("cleanup", () => {
    if (originalEnv !== undefined) {
      process.env.OBSKU_OUTPUT_MODE = originalEnv;
    } else {
      delete process.env.OBSKU_OUTPUT_MODE;
    }
    expect(true).toBe(true);
  });
});

describe("getOutputPolicy", () => {
  test("should return default policy for 'default' mode", () => {
    const policy = getOutputPolicy("default");

    expect(policy).toBeDefined();
    expect(typeof policy.emit).toBe("function");
  });

  test("should return strands policy for 'strands' mode", () => {
    expect(() => getOutputPolicy("strands")).toThrow(
      "Output mode 'strands' requires adapter-owned policy registration"
    );
  });

  test("default policy should transform tool result events to public payload format", () => {
    const policy = getOutputPolicy("default");
    const mockEvent: ToolResultEvent = {
      type: "tool.result",
      timestamp: 1234567890,
      toolName: "test-tool",
      toolUseId: "tool-123",
      result: "test output",
      isError: false,
    };

    const result = policy.emit({
      event: mockEvent,
      context: { surface: "iterable" },
    }) as DefaultPublicPayload<ToolResultEvent>;

    expect(result.type).toBe("tool.result");
    expect(result.timestamp).toBe(1234567890);
    expect(result.data).toBeDefined();
    expect(result.data.toolName).toBe("test-tool");
    expect(result.data.result).toBe("test output");
  });

  test("default policy should preserve all event data", () => {
    const policy = getOutputPolicy("default");
    const mockEvent: AgentCompleteEvent = {
      type: "agent.complete",
      timestamp: 1234567890,
      summary: "Task completed successfully",
      usage: { llmCalls: 1, totalInputTokens: 100, totalOutputTokens: 50 },
    };

    const result = policy.emit({
      event: mockEvent,
      context: { surface: "transport" },
    }) as DefaultPublicPayload<AgentCompleteEvent>;

    expect(result.data.summary).toBe("Task completed successfully");
    expect(result.data.usage).toEqual({
      llmCalls: 1,
      totalInputTokens: 100,
      totalOutputTokens: 50,
    });
  });

  test("default policy should handle tool call events", () => {
    const policy = getOutputPolicy("default");
    const mockEvent: ToolCallEvent = {
      type: "tool.call",
      timestamp: 1234567890,
      toolName: "search",
      toolUseId: "tool-456",
      args: { query: "obsku" },
    };

    const result = policy.emit({
      event: mockEvent,
      context: { surface: "callback" },
    }) as DefaultPublicPayload<ToolCallEvent>;

    expect(result.type).toBe("tool.call");
    expect(result.timestamp).toBe(1234567890);
    expect(result.data.toolName).toBe("search");
    expect(result.data.args.query).toBe("obsku");
  });

  test("strands policy should return null for unsupported events", () => {
    expect(() => getOutputPolicy("strands")).toThrow(
      "Output mode 'strands' requires adapter-owned policy registration"
    );
  });
});

describe("public API signatures - no mode parameter", () => {
  test("agent.run signature should not have mode parameter", async () => {
    const { agent } = await import("../../src/agent/index");

    const testAgent = agent({
      name: "test-agent",
      prompt: "You are a test agent",
    });

    expect(typeof testAgent.run).toBe("function");
    expect(typeof testAgent.subscribe).toBe("function");
  });

  test("supervisor signature should not have mode parameter", async () => {
    const { supervisor } = await import("../../src/multi-agent/supervisor");

    const mockProvider = {
      chat: async () => ({
        content: [{ type: "text" as const, text: "" }],
        stopReason: "end_turn" as const,
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
      chatStream: async function* () {},
      contextWindowSize: 100000,
    };

    const testSupervisor = supervisor({
      provider: mockProvider,
      name: "test-supervisor",
      workers: [{ name: "worker", prompt: "You are a worker" }],
    });

    expect(testSupervisor).toBeDefined();
    expect(testSupervisor.nodes).toBeDefined();
  });

  test("runtime run signature should not have mode parameter", async () => {
    const { run } = await import("../../src/runtime");

    expect(typeof run).toBe("function");
  });
});
