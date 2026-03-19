import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { z } from "zod";
import { type EmitFn, executeSyncTools } from "../../src/agent/tool-executor";
import { type InternalPlugin, PluginExecError, plugin } from "../../src/plugin";
import type { AgentEvent, ParamDef } from "../../src/types";
import { isToolOutput } from "../../src/utils";
import { defaultAgentDef, defaultConfig, toResolvedTools } from "../utils/helpers";

function makeToolCall(
  name: string,
  input: Record<string, unknown> = {},
  id?: string
): { input: Record<string, unknown>; name: string; toolUseId: string; type: "tool_use" } {
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

function makeInternalPlugin(name: string, result: unknown): InternalPlugin {
  const params: Record<string, ParamDef> = {};
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
    params,
  };
}

function _makeFailingPlugin(name: string, error: string): InternalPlugin {
  const params: Record<string, ParamDef> = {};
  return {
    description: `failing ${name}`,
    execute: () => Effect.fail(new PluginExecError(name, new Error(error))),
    name,
    params,
  };
}

describe("Plugin Layer ToolOutput Detection", () => {
  describe("isToolOutput() behavior", () => {
    test("should detect ToolOutput with content and isError", () => {
      const toolOutput = { content: "error message", isError: true };
      expect(isToolOutput(toolOutput)).toBe(true);
    });

    test("should detect ToolOutput with content only (no isError)", () => {
      const toolOutput = { content: "success message" };
      expect(isToolOutput(toolOutput)).toBe(true);
    });

    test("should NOT detect plain string as ToolOutput", () => {
      expect(isToolOutput("plain string")).toBe(false);
    });

    test("should NOT detect plain object as ToolOutput", () => {
      expect(isToolOutput({ foo: 1 })).toBe(false);
    });

    test("should NOT detect null as ToolOutput", () => {
      expect(isToolOutput(null)).toBe(false);
    });
  });

  describe("ToolOutput with isError=true -> ToolResult with isError: true", () => {
    test("plugin returning ToolOutput{content, isError: true} should produce ToolResult with isError: true", async () => {
      const plugins = new Map<string, InternalPlugin>([
        [
          "error-plugin",
          makeInternalPlugin("error-plugin", {
            content: "Something went wrong",
            isError: true,
          }),
        ],
      ]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("error-plugin")];

      const exit = await Effect.runPromiseExit(
        executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results).toHaveLength(1);
        expect(results[0].toolName).toBe("error-plugin");
        expect(results[0].result).toBe("Something went wrong");
        expect(results[0].isError).toBe(true);
      }
    });
  });

  describe("ToolOutput with isError=false -> ToolResult with isError: false", () => {
    test("plugin returning ToolOutput{content, isError: false} should produce ToolResult with isError: false", async () => {
      const plugins = new Map<string, InternalPlugin>([
        [
          "success-plugin",
          makeInternalPlugin("success-plugin", {
            content: "Operation completed",
            isError: false,
          }),
        ],
      ]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("success-plugin")];

      const exit = await Effect.runPromiseExit(
        executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results[0].isError).toBe(false);
        expect(results[0].result).toBe("Operation completed");
      }
    });
  });

  describe("ToolOutput without isError -> ToolResult without isError (undefined)", () => {
    test("plugin returning ToolOutput{content} (no isError) should produce ToolResult without isError", async () => {
      const plugins = new Map<string, InternalPlugin>([
        [
          "neutral-plugin",
          makeInternalPlugin("neutral-plugin", {
            content: "Some result",
          }),
        ],
      ]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("neutral-plugin")];

      const exit = await Effect.runPromiseExit(
        executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results[0].isError).toBe(false);
        expect(results[0].result).toBe("Some result");
      }
    });
  });

  describe("Backward compatibility: plain string returns", () => {
    test("plugin returning plain string should have result as string, no isError", async () => {
      const plugins = new Map<string, InternalPlugin>([
        ["string-plugin", makeInternalPlugin("string-plugin", "plain string result")],
      ]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("string-plugin")];

      const exit = await Effect.runPromiseExit(
        executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results[0].result).toBe("plain string result");
        expect(results[0].isError).toBe(false);
      }
    });
  });

  describe("Backward compatibility: plain object returns", () => {
    test("plugin returning plain object should have result as JSON string, no isError", async () => {
      const plugins = new Map<string, InternalPlugin>([
        ["object-plugin", makeInternalPlugin("object-plugin", { bar: "baz", foo: 1 })],
      ]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("object-plugin")];

      const exit = await Effect.runPromiseExit(
        executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results[0].result).toBe(JSON.stringify({ bar: "baz", foo: 1 }));
        expect(results[0].isError).toBe(false);
      }
    });
  });

  describe("plugin() factory with ToolOutput returns", () => {
    test("plugin factory with ToolOutput{content, isError: true}", async () => {
      const p = plugin({
        description: "Returns error via ToolOutput",
        name: "error-reporting",
        params: z.object({}),
        run: async () => {
          return {
            content: "Validation failed",
            isError: true,
          };
        },
      });

      const plugins = new Map<string, InternalPlugin>([["error-reporting", p]]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("error-reporting")];

      const exit = await Effect.runPromiseExit(
        executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results[0].result).toBe("Validation failed");
        expect(results[0].isError).toBe(true);
      }
    });

    test("plugin factory with ToolOutput{content, isError: false}", async () => {
      const p = plugin({
        description: "Returns success via ToolOutput",
        name: "success-reporting",
        params: z.object({}),
        run: async () => {
          return {
            content: "Data retrieved",
            isError: false,
          };
        },
      });

      const plugins = new Map<string, InternalPlugin>([["success-reporting", p]]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("success-reporting")];

      const exit = await Effect.runPromiseExit(
        executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results[0].result).toBe("Data retrieved");
        expect(results[0].isError).toBe(false);
      }
    });

    test("plugin factory with plain string return (backward compat)", async () => {
      const p = plugin({
        description: "Returns string",
        name: "string-plugin",
        params: z.object({}),
        run: async () => {
          return "Simple result";
        },
      });

      const plugins = new Map<string, InternalPlugin>([["string-plugin", p]]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("string-plugin")];

      const exit = await Effect.runPromiseExit(
        executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results[0].result).toBe("Simple result");
        expect(results[0].isError).toBe(false);
      }
    });
  });

  describe("Plugin throwing error", () => {
    test("plugin throwing error should produce error result via catchAll", async () => {
      const p = plugin({
        description: "Throws error",
        name: "throwing-plugin",
        params: z.object({}),
        run: async () => {
          throw new Error("Something broke");
        },
      });

      const plugins = new Map<string, InternalPlugin>([["throwing-plugin", p]]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("throwing-plugin")];

      const exit = await Effect.runPromiseExit(
        executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results[0].toolName).toBe("throwing-plugin");
        expect(results[0].result).toContain("Something broke");
      }
    });
  });

  describe("AsyncIterable plugins - ToolOutput NOT detected in streaming", () => {
    test("async iterable plugin should use last value, ToolOutput not detected", async () => {
      const p = plugin({
        description: "Returns async iterable",
        name: "streaming-plugin",
        params: z.object({}),
        run: async function* () {
          yield "chunk1";
          yield "chunk2";
          return "final result";
        },
      });

      const plugins = new Map<string, InternalPlugin>([["streaming-plugin", p]]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("streaming-plugin")];

      const exit = await Effect.runPromiseExit(
        executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results[0].result).toBeDefined();
      }
    });

    test("async iterable yielding ToolOutput-like values uses last yielded value, NOT detecting as ToolOutput", async () => {
      const p = plugin({
        description: "Yields ToolOutput-like values",
        name: "streaming-error-plugin",
        params: z.object({}),
        run: async function* () {
          yield { content: "partial", isError: false };
          yield { content: "final", isError: true };
        },
      });

      const plugins = new Map<string, InternalPlugin>([["streaming-error-plugin", p]]);
      const { emit } = captureEmit();
      const calls = [makeToolCall("streaming-error-plugin")];

      const exit = await Effect.runPromiseExit(
        executeSyncTools(calls, toResolvedTools(plugins), defaultAgentDef, defaultConfig, emit)
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        const results = exit.value;
        expect(results[0].result).toBe(JSON.stringify({ content: "final", isError: true }));
        expect(results[0].isError).toBe(false);
      }
    });
  });

  describe("InternalPlugin interface contract", () => {
    test("InternalPlugin.execute signature unchanged - returns Effect<unknown, PluginExecError>", async () => {
      const params: Record<string, ParamDef> = {};
      const mockPlugin: InternalPlugin = {
        description: "test",
        execute: () => Effect.succeed({ content: "result", isError: true }),
        name: "test",
        params,
      };

      const result = await Effect.runPromise(mockPlugin.execute({}));
      expect(result).toEqual({ content: "result", isError: true });
    });
  });
});
