import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { type EmitFn, executeSyncTools, startBackgroundTasks } from "../../src/agent/tool-executor";
import { TaskManager } from "../../src/background";
import { type InternalPlugin, PluginExecError } from "../../src/plugin";
import type { AgentEvent, ToolUseContent } from "../../src/types";
import { defaultAgentDef, defaultConfig, toResolvedTools } from "../utils/helpers";

function makePlugin(name: string, result: unknown): InternalPlugin {
  return {
    description: `mock ${name}`,
    execute: () => {
      if (
        result !== null &&
        typeof result === "object" &&
        "content" in result &&
        typeof (result as Record<string, unknown>).content === "string"
      ) {
        const r = result as { content: string; isError?: boolean };
        return Effect.succeed({ isError: r.isError, result: r.content });
      }
      return Effect.succeed({
        result: typeof result === "string" ? result : JSON.stringify(result),
      });
    },
    name,
    params: {},
  };
}

function makeFailingPlugin(name: string, error: string): InternalPlugin {
  return {
    description: `failing ${name}`,
    execute: () => Effect.fail(new PluginExecError(name, new Error(error))),
    name,
    params: {},
  };
}

function makeSlowPlugin(name: string, delayMs: number): InternalPlugin {
  return {
    description: `slow ${name}`,
    execute: () =>
      Effect.promise(() => new Promise((resolve) => setTimeout(() => resolve("done"), delayMs))),
    name,
    params: {},
  };
}

function makeToolCall(
  name: string,
  input: Record<string, unknown> = {},
  id?: string
): ToolUseContent {
  return {
    input,
    name,
    toolUseId: id ?? `tu-${name}`,
    type: "tool_use",
  };
}

function captureEmit(): { emit: EmitFn; events: Array<AgentEvent> } {
  const events: Array<AgentEvent> = [];
  const emit: EmitFn = (event) => {
    events.push(event);
    return Effect.succeed(true);
  };
  return { emit, events };
}

describe("ToolResult.isError - Error Sources", () => {
  describe("executeSyncTools error sources", () => {
    test("Tool not found → ToolResult.isError === true", async () => {
      const plugins = new Map<string, InternalPlugin>();
      const { emit } = captureEmit();
      const calls = [makeToolCall("nonexistent")];

      const exit = await Effect.runPromiseExit(
        executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results).toHaveLength(1);
        expect(results[0].isError).toBe(true);
        const parsed = JSON.parse(results[0].result);
        expect(parsed.error).toContain("Tool not found: nonexistent");
      }
    });

    test("Plugin exec error (without telemetry) → isError === true", async () => {
      const plugins = new Map<string, InternalPlugin>([
        ["broken", makeFailingPlugin("broken", "plugin crashed")],
      ]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("broken")];

      const exit = await Effect.runPromiseExit(
        executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results).toHaveLength(1);
        expect(results[0].isError).toBe(true);
        const parsed = JSON.parse(results[0].result);
        expect(parsed.error).toContain("plugin crashed");
      }
    });

    test("Plugin exec error (with telemetry) → isError === true", async () => {
      const plugins = new Map<string, InternalPlugin>([
        ["broken", makeFailingPlugin("broken", "plugin crashed with telemetry")],
      ]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("broken")];
      const telemetryConfig = { enabled: true, serviceName: "test" };

      const exit = await Effect.runPromiseExit(
        executeSyncTools(
          calls,
          toResolvedTools(plugins),
          defaultAgentDef,
          defaultConfig,
          emit,
          telemetryConfig
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results).toHaveLength(1);
        expect(results[0].isError).toBe(true);
        const parsed = JSON.parse(results[0].result);
        expect(parsed.error).toContain("plugin crashed with telemetry");
      }
    });

    test("Timeout → isError === true", async () => {
      const plugins = new Map<string, InternalPlugin>([["slow", makeSlowPlugin("slow", 100)]]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("slow")];
      // Set very short timeout to trigger timeout error
      const configWithShortTimeout = { ...defaultConfig, toolTimeout: 10 };

      const exit = await Effect.runPromiseExit(
        executeSyncTools(
          calls,
          toResolvedTools(plugins),
          defaultAgentDef,
          configWithShortTimeout,
          emit
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results).toHaveLength(1);
        expect(results[0].isError).toBe(true);
        const parsed = JSON.parse(results[0].result);
        expect(parsed.error).toBeDefined();
      }
    });

    test("Successful tool execution → isError is undefined/false", async () => {
      const plugins = new Map<string, InternalPlugin>([
        ["echo", makePlugin("echo", { text: "hello" })],
      ]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("echo", { text: "hello" })];

      const exit = await Effect.runPromiseExit(
        executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results).toHaveLength(1);
        expect(results[0].isError).toBe(false);
        const parsed = JSON.parse(results[0].result);
        expect(parsed.text).toBe("hello");
      }
    });
  });

  describe("startBackgroundTasks error sources", () => {
    test("Background tool not found → error JSON has isError", async () => {
      const plugins = new Map<string, InternalPlugin>();
      const taskManager = new TaskManager();
      const { emit } = captureEmit();
      const calls = [makeToolCall("missing-tool")];

      const exit = await Effect.runPromiseExit(
        startBackgroundTasks(calls, toResolvedTools(plugins), taskManager, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results).toHaveLength(1);
        const parsed = JSON.parse(results[0].result);
        expect(parsed.error).toContain("Tool not found: missing-tool");
        // Note: Background tasks return isError in the result JSON, not at ToolResult level
        expect(parsed.isError).toBe(true);
      }
    });
  });
});
