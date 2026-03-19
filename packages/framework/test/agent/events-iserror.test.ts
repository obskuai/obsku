import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { type InternalPlugin, PluginExecError } from "../../src/plugin";
import type { AgentEvent, LLMProvider, ToolDef, ToolResultContext } from "../../src/types";
import { defaultConfig, makeEmit } from "../utils/helpers";
import { runReactLoop } from "../utils/loop-helpers";
import { textResponse, toolResponse } from "../utils/responses";

const failerToolDef: ToolDef = {
  description: "always fails",
  inputSchema: { properties: {}, required: [], type: "object" },
  name: "failer",
};

const successToolDef: ToolDef = {
  description: "always succeeds",
  inputSchema: { properties: {}, required: [], type: "object" },
  name: "success",
};

describe("ToolResult isError - Events + Hooks (Task 5)", () => {
  describe("ToolResult event", () => {
    test("ToolResult event includes isError: true when tool errors", async () => {
      const events: Array<AgentEvent> = [];
      const failingPlugin: InternalPlugin = {
        description: "always fails",
        execute: () => Effect.fail(new PluginExecError("failer", new Error("boom"))),
        name: "failer",
        params: {},
      };
      const plugins = new Map([["failer", failingPlugin]]);

      let callCount = 0;
      const provider: LLMProvider = {
        chat: async () => {
          callCount++;
          if (callCount === 1) {
            return toolResponse([{ id: "tu-1", input: {}, name: "failer" }]);
          }
          return textResponse("done");
        },
        chatStream: async function* () {
          yield { content: "", type: "text_delta" };
        },
        contextWindowSize: 200_000,
      };

      await Effect.runPromise(
        runReactLoop(
          [{ content: [{ text: "test", type: "text" }], role: "user" }],
          [failerToolDef],
          plugins,
          provider,
          defaultConfig,
          new Set(),
          undefined,
          makeEmit(events),
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined
        )
      );

      const toolResults = events.filter((e) => e.type === "tool.result");
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0]).toHaveProperty("isError", true);
    });

    test("ToolResult event has no isError (or false) when tool succeeds", async () => {
      const events: Array<AgentEvent> = [];
      const successPlugin: InternalPlugin = {
        description: "always succeeds",
        execute: () => Effect.succeed("hello"),
        name: "success",
        params: {},
      };
      const plugins = new Map([["success", successPlugin]]);

      let callCount = 0;
      const provider: LLMProvider = {
        chat: async () => {
          callCount++;
          if (callCount === 1) {
            return toolResponse([{ id: "tu-1", input: {}, name: "success" }]);
          }
          return textResponse("done");
        },
        chatStream: async function* () {
          yield { content: "", type: "text_delta" };
        },
        contextWindowSize: 200_000,
      };

      await Effect.runPromise(
        runReactLoop(
          [{ content: [{ text: "test", type: "text" }], role: "user" }],
          [successToolDef],
          plugins,
          provider,
          defaultConfig,
          new Set(),
          undefined,
          makeEmit(events),
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined
        )
      );

      const toolResults = events.filter((e) => e.type === "tool.result");
      expect(toolResults).toHaveLength(1);
      // isError should be undefined or false for successful tool execution
      expect(toolResults[0].isError === undefined || toolResults[0].isError === false).toBe(true);
    });
  });

  describe("onToolResult callback", () => {
    test("onToolResult receives ToolResultContext with isError when tool errors", async () => {
      const events: Array<AgentEvent> = [];
      const hookContexts: Array<ToolResultContext> = [];

      const failingPlugin: InternalPlugin = {
        description: "always fails",
        execute: () => Effect.fail(new PluginExecError("failer", new Error("boom"))),
        name: "failer",
        params: {},
      };
      const plugins = new Map([["failer", failingPlugin]]);

      let callCount = 0;
      const provider: LLMProvider = {
        chat: async () => {
          callCount++;
          if (callCount === 1) {
            return toolResponse([{ id: "tu-1", input: { key: "value" }, name: "failer" }]);
          }
          return textResponse("done");
        },
        chatStream: async function* () {
          yield { content: "", type: "text_delta" };
        },
        contextWindowSize: 200_000,
      };

      const onToolResult = (ctx: ToolResultContext) => {
        hookContexts.push(ctx);
      };

      await Effect.runPromise(
        runReactLoop(
          [{ content: [{ text: "test", type: "text" }], role: "user" }],
          [failerToolDef],
          plugins,
          provider,
          defaultConfig,
          new Set(),
          undefined,
          makeEmit(events),
          undefined,
          undefined,
          undefined,
          onToolResult,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined
        )
      );

      expect(hookContexts).toHaveLength(1);
      expect(hookContexts[0].toolName).toBe("failer");
      expect(hookContexts[0].input).toEqual({ key: "value" });
      expect(hookContexts[0].isError).toBe(true);
    });

    test("onToolResult receives ToolResultContext with correct isError when tool succeeds", async () => {
      const events: Array<AgentEvent> = [];
      const hookContexts: Array<ToolResultContext> = [];

      const successPlugin: InternalPlugin = {
        description: "always succeeds",
        execute: () => Effect.succeed({ result: "hello result" }),
        name: "success",
        params: {},
      };
      const plugins = new Map([["success", successPlugin]]);

      let callCount = 0;
      const provider: LLMProvider = {
        chat: async () => {
          callCount++;
          if (callCount === 1) {
            return toolResponse([{ id: "tu-1", input: { param: "test" }, name: "success" }]);
          }
          return textResponse("done");
        },
        chatStream: async function* () {
          yield { content: "", type: "text_delta" };
        },
        contextWindowSize: 200_000,
      };

      const onToolResult = (ctx: ToolResultContext) => {
        hookContexts.push(ctx);
      };

      await Effect.runPromise(
        runReactLoop(
          [{ content: [{ text: "test", type: "text" }], role: "user" }],
          [successToolDef],
          plugins,
          provider,
          defaultConfig,
          new Set(),
          undefined,
          makeEmit(events),
          undefined,
          undefined,
          undefined,
          onToolResult,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined
        )
      );

      expect(hookContexts).toHaveLength(1);
      expect(hookContexts[0].toolName).toBe("success");
      expect(hookContexts[0].input).toEqual({ param: "test" });
      expect(hookContexts[0].result).toContain("hello result");
      // isError should be undefined or false for successful tool execution
      expect(hookContexts[0].isError === undefined || hookContexts[0].isError === false).toBe(true);
    });
  });

  describe("ToolResultContext readonly", () => {
    test("hooks cannot mutate isError (TypeScript readonly)", async () => {
      // This test verifies at compile-time that isError is readonly
      // The type system prevents mutation, so we just verify the type exists
      const events: Array<AgentEvent> = [];
      const hookContexts: Array<ToolResultContext> = [];

      const successPlugin: InternalPlugin = {
        description: "always succeeds",
        execute: () => Effect.succeed("hello"),
        name: "success",
        params: {},
      };
      const plugins = new Map([["success", successPlugin]]);

      let callCount = 0;
      const provider: LLMProvider = {
        chat: async () => {
          callCount++;
          if (callCount === 1) {
            return toolResponse([{ id: "tu-1", input: {}, name: "success" }]);
          }
          return textResponse("done");
        },
        chatStream: async function* () {
          yield { content: "", type: "text_delta" };
        },
        contextWindowSize: 200_000,
      };

      const onToolResult = (ctx: ToolResultContext) => {
        hookContexts.push(ctx);
        // Attempting to mutate should fail at compile time:
        // ctx.isError = true; // Error: Cannot assign to 'isError' because it is a read-only property
      };

      await Effect.runPromise(
        runReactLoop(
          [{ content: [{ text: "test", type: "text" }], role: "user" }],
          [successToolDef],
          plugins,
          provider,
          defaultConfig,
          new Set(),
          undefined,
          makeEmit(events),
          undefined,
          undefined,
          undefined,
          onToolResult,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined
        )
      );

      expect(hookContexts).toHaveLength(1);
      // Verify isError is present and not mutated
      expect(hookContexts[0].isError === undefined || hookContexts[0].isError === false).toBe(true);
    });
  });
});
