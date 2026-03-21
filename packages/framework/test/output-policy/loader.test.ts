import { beforeEach, describe, expect, test } from "bun:test";
import { type LoadOutputPolicyOptions, loadOutputPolicy } from "../../src/output-policy/loader";
import type { DefaultPublicPayload } from "../../src/output-policy/types";
import type { AgentThinkingEvent, ToolCallEvent } from "../../src/types/events";

describe("loadOutputPolicy", () => {
  const originalEnv = process.env.OBSKU_OUTPUT_MODE;

  beforeEach(() => {
    delete process.env.OBSKU_OUTPUT_MODE;
  });

  test("should return default mode when nothing is specified", () => {
    const result = loadOutputPolicy();

    expect(result.mode).toBe("default");
    expect(result.policy).toBeDefined();
    expect(result.policy.emit).toBeFunction();
  });

  test("should return default mode when env var is set to 'default'", () => {
    process.env.OBSKU_OUTPUT_MODE = "default";

    const result = loadOutputPolicy();

    expect(result.mode).toBe("default");
  });

  test("env var OBSKU_OUTPUT_MODE='strands' preserves strands mode selection", () => {
    process.env.OBSKU_OUTPUT_MODE = "strands";

    expect(() => loadOutputPolicy()).toThrow(
      "Output mode 'strands' requires adapter-owned policy registration"
    );
  });

  test("should select mode from config when env var is not set", () => {
    const config: LoadOutputPolicyOptions["config"] = {
      mode: "default",
    };

    const result = loadOutputPolicy({ config });

    expect(result.mode).toBe("default");
  });

  test("config { mode: 'strands' } preserves strands mode selection", () => {
    const config: LoadOutputPolicyOptions["config"] = {
      mode: "strands",
    };

    expect(() => loadOutputPolicy({ config })).toThrow(
      "Output mode 'strands' requires adapter-owned policy registration"
    );
  });

  test("env var OBSKU_OUTPUT_MODE should override config.mode before loading", () => {
    process.env.OBSKU_OUTPUT_MODE = "strands";
    const config: LoadOutputPolicyOptions["config"] = {
      mode: "default",
    };

    expect(() => loadOutputPolicy({ config })).toThrow(
      "Output mode 'strands' requires adapter-owned policy registration"
    );
  });

  test("env var 'default' overrides config 'strands'", () => {
    process.env.OBSKU_OUTPUT_MODE = "default";
    const config: LoadOutputPolicyOptions["config"] = {
      mode: "strands",
    };

    const result = loadOutputPolicy({ config });

    expect(result.mode).toBe("default");
  });

  test("should handle invalid env var gracefully (fallback to config)", () => {
    process.env.OBSKU_OUTPUT_MODE = "invalid-mode";
    const config: LoadOutputPolicyOptions["config"] = {
      mode: "default",
    };

    const result = loadOutputPolicy({ config });

    expect(result.mode).toBe("default");
  });

  test("should fallback to default when env var is invalid and no config", () => {
    process.env.OBSKU_OUTPUT_MODE = "invalid-mode";

    const result = loadOutputPolicy();

    expect(result.mode).toBe("default");
  });

  test("should return a valid policy object with emit method", () => {
    const result = loadOutputPolicy();

    expect(result.policy).toBeDefined();
    expect(typeof result.policy.emit).toBe("function");
  });

  test("default policy.emit should transform events correctly", () => {
    const { policy } = loadOutputPolicy();
    const mockEvent: AgentThinkingEvent = {
      type: "agent.thinking",
      timestamp: 1234567890,
      content: "Test thinking",
    };

    const result = policy.emit({
      event: mockEvent,
      context: { surface: "callback" },
    }) as DefaultPublicPayload<AgentThinkingEvent>;

    expect(result.type).toBe("agent.thinking");
    expect(result.timestamp).toBe(1234567890);
    expect(result.data).toBeDefined();
    expect(result.data.content).toBe("Test thinking");
  });

  test("default policy.emit should handle tool call events", () => {
    const { policy } = loadOutputPolicy();
    const mockEvent: ToolCallEvent = {
      type: "tool.call",
      timestamp: 1234567890,
      toolName: "test-tool",
      toolUseId: "tool-123",
      args: { query: "test" },
    };

    const result = policy.emit({
      event: mockEvent,
      context: { surface: "iterable" },
    }) as DefaultPublicPayload<ToolCallEvent>;

    expect(result.type).toBe("tool.call");
    expect(result.timestamp).toBe(1234567890);
    expect(result.data.toolName).toBe("test-tool");
    expect(result.data.args.query).toBe("test");
  });

  test("strands mode now requires adapter-owned registration", () => {
    process.env.OBSKU_OUTPUT_MODE = "strands";

    expect(() => loadOutputPolicy()).toThrow(
      "Output mode 'strands' requires adapter-owned policy registration"
    );
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
