import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type {
  AgentEvent,
  LLMCallContext,
  LLMProvider,
  LLMResponse,
  Message,
  ToolDef,
} from "../../src/types";
import { defaultConfig, makeEmit, makeProvider } from "../utils/helpers";
import { runReactLoop, runStreamReactLoop } from "../utils/loop-helpers";
import { textResponse } from "../utils/responses";

describe("beforeLLMCall / afterLLMCall hooks", () => {
  test("beforeLLMCall called before each provider.chat() invocation", async () => {
    const events: Array<AgentEvent> = [];
    const hookCalls: Array<string> = [];

    const provider = makeProvider(async () => {
      hookCalls.push("provider");
      return textResponse("done");
    });

    const beforeLLMCall = (ctx: LLMCallContext) => {
      hookCalls.push("before");
      expect(ctx.iteration).toBe(0);
    };

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events),
        undefined,
        undefined,
        undefined,
        undefined, // onToolResult
        undefined,
        undefined,
        undefined,
        undefined,
        beforeLLMCall
      )
    );

    expect(hookCalls).toContain("before");
    expect(hookCalls).toEqual(["before", "provider"]);
  });

  test("beforeLLMCall can modify messages array (mutable)", async () => {
    const events: Array<AgentEvent> = [];
    let hasInjected = false;

    const provider = makeProvider(async (msgs) => {
      hasInjected = msgs.some((m) =>
        m.content.some((c) => c.type === "text" && c.text === "Injected context")
      );
      return textResponse("done");
    });

    const beforeLLMCall = (ctx: LLMCallContext) => {
      ctx.messages.push({
        content: [{ text: "Injected context", type: "text" }],
        role: "user",
      });
    };

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events),
        undefined,
        undefined,
        undefined,
        undefined, // onToolResult
        undefined,
        undefined,
        undefined,
        undefined,
        beforeLLMCall
      )
    );

    expect(hasInjected).toBe(true);
  });

  test("beforeLLMCall can modify tools array", async () => {
    const events: Array<AgentEvent> = [];
    let receivedTools: ToolDef[] | undefined;

    const provider = makeProvider(async (_msgs, tools) => {
      receivedTools = tools;
      return textResponse("done");
    });

    const beforeLLMCall = (ctx: LLMCallContext) => {
      ctx.tools.push({
        description: "Added dynamically",
        inputSchema: { properties: {}, type: "object" },
        name: "dynamic-tool",
      });
    };

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events),
        undefined,
        undefined,
        undefined,
        undefined, // onToolResult
        undefined,
        undefined,
        undefined,
        undefined,
        beforeLLMCall
      )
    );

    expect(receivedTools?.some((t) => t.name === "dynamic-tool")).toBe(true);
  });

  test("beforeLLMCall can replace messages and tools via return value", async () => {
    const events: Array<AgentEvent> = [];
    let receivedMessages: Array<Message> | undefined;
    let receivedTools: Array<ToolDef> | undefined;

    const provider = makeProvider(async (msgs, tools) => {
      receivedMessages = msgs;
      receivedTools = tools;
      return textResponse("done");
    });

    const allowedTool: ToolDef = {
      description: "Allowed replacement",
      inputSchema: { properties: {}, type: "object" },
      name: "allowed-tool",
    };
    const blockedTool: ToolDef = {
      description: "Blocked replacement",
      inputSchema: { properties: {}, type: "object" },
      name: "blocked-tool",
    };

    const beforeLLMCall = () => ({
      messages: [
        { content: [{ text: "returned context", type: "text" as const }], role: "user" as const },
      ] satisfies Array<Message>,
      tools: [allowedTool, blockedTool],
    });

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [allowedTool],
        new Map(),
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
        beforeLLMCall
      )
    );

    expect(receivedMessages).toEqual([
      { content: [{ text: "returned context", type: "text" }], role: "user" },
    ]);
    expect(receivedTools).toEqual([allowedTool]);
  });

  test("afterLLMCall called after each provider.chat() with response", async () => {
    const events: Array<AgentEvent> = [];
    const hookResponses: Array<LLMResponse> = [];

    const provider = makeProvider(async () => textResponse("hello from llm"));

    const afterLLMCall = (ctx: LLMCallContext & { response: LLMResponse }) => {
      hookResponses.push(ctx.response);
    };

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events),
        undefined,
        undefined,
        undefined,
        undefined, // onToolResult
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        afterLLMCall
      )
    );

    expect(hookResponses).toHaveLength(1);
    expect(hookResponses[0].content[0]).toEqual({
      text: "hello from llm",
      type: "text",
    });
  });

  test("afterLLMCall receives response for inspection", async () => {
    const events: Array<AgentEvent> = [];
    let capturedResponse: LLMResponse | undefined;

    const provider = makeProvider(async () => textResponse("original"));

    const afterLLMCall = (ctx: LLMCallContext & { response: LLMResponse }) => {
      capturedResponse = ctx.response;
    };

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events),
        undefined,
        undefined,
        undefined,
        undefined, // onToolResult
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        afterLLMCall
      )
    );

    expect(result).toBe("original");
    expect(capturedResponse?.content[0]).toEqual({ text: "original", type: "text" });
  });

  test("hook error is swallowed (agent continues)", async () => {
    const events: Array<AgentEvent> = [];

    const provider = makeProvider(async () => textResponse("done"));

    const beforeLLMCall = () => {
      throw new Error("Hook error - should be swallowed");
    };

    const afterLLMCall = () => {
      throw new Error("After hook error - should be swallowed");
    };

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events),
        undefined,
        undefined,
        undefined,
        undefined, // onToolResult
        undefined,
        undefined,
        undefined,
        undefined,
        beforeLLMCall,
        afterLLMCall
      )
    );

    expect(result).toBe("done");
    const hookErrorEvents = events.filter((e) => e.type === "hook.error");
    expect(hookErrorEvents).toHaveLength(2);
    const hookNames = hookErrorEvents.map((e) => (e as { hookName: string }).hookName);
    expect(hookNames).toContain("beforeLLMCall");
    expect(hookNames).toContain("afterLLMCall");
  });

  test("async hooks are awaited", async () => {
    const events: Array<AgentEvent> = [];
    const executionOrder: Array<string> = [];

    const provider = makeProvider(async () => {
      executionOrder.push("provider");
      return textResponse("done");
    });

    const beforeLLMCall = async (ctx: LLMCallContext) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push("before");
      ctx.messages.push({
        content: [{ text: "async injected", type: "text" }],
        role: "user",
      });
    };

    const afterLLMCall = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push("after");
    };

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events),
        undefined,
        undefined,
        undefined,
        undefined, // onToolResult
        undefined,
        undefined,
        undefined,
        undefined,
        beforeLLMCall,
        afterLLMCall
      )
    );

    expect(executionOrder).toEqual(["before", "provider", "after"]);
  });

  test("hooks work with multi-step agent (called each iteration)", async () => {
    const events: Array<AgentEvent> = [];
    const beforeCalls: Array<number> = [];
    const afterCalls: Array<number> = [];
    let callCount = 0;

    const provider = makeProvider(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: [
            {
              input: {},
              name: "echo",
              toolUseId: "t1",
              type: "tool_use",
            },
          ],
          stopReason: "tool_use" as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      }
      return textResponse("final");
    });

    const beforeLLMCall = (ctx: LLMCallContext) => {
      beforeCalls.push(ctx.iteration);
    };

    const afterLLMCall = (ctx: LLMCallContext & { response: LLMResponse }) => {
      afterCalls.push(ctx.iteration);
    };

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [
          {
            description: "echo",
            inputSchema: { properties: {}, type: "object" },
            name: "echo",
          },
        ],
        new Map([
          [
            "echo",
            {
              description: "echo",
              execute: () => Effect.succeed("ok"),
              name: "echo",
              params: {},
            },
          ],
        ]),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events),
        undefined,
        undefined,
        undefined,
        undefined, // onToolResult
        undefined,
        undefined,
        undefined,
        undefined,
        beforeLLMCall,
        afterLLMCall
      )
    );

    expect(callCount).toBe(2);
    expect(beforeCalls).toEqual([0, 1]);
    expect(afterCalls).toEqual([0, 1]);
  });

  test("agent without hooks works unchanged (backward compat)", async () => {
    const events: Array<AgentEvent> = [];

    const provider = makeProvider(async () => textResponse("done"));

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events)
      )
    );

    expect(result).toBe("done");
  });

  test("hooks work with streaming loop", async () => {
    const events: Array<AgentEvent> = [];
    const beforeCalls: Array<number> = [];
    const afterCalls: Array<LLMResponse> = [];

    const streamProvider: LLMProvider = {
      chat: async () => textResponse("non-stream"),
      chatStream: async function* () {
        yield { content: "Hello", type: "text_delta" };
        yield { content: " World", type: "text_delta" };
        yield {
          stopReason: "end_turn",
          type: "message_end",
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      contextWindowSize: 200_000,
    };

    const beforeLLMCall = (ctx: LLMCallContext) => {
      beforeCalls.push(ctx.iteration);
    };

    const afterLLMCall = (ctx: LLMCallContext & { response: LLMResponse }) => {
      afterCalls.push(ctx.response);
    };

    await Effect.runPromise(
      runStreamReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        streamProvider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events),
        undefined,
        undefined,
        undefined,
        undefined, // onToolResult
        undefined,
        undefined,
        undefined,
        undefined,
        beforeLLMCall,
        afterLLMCall
      )
    );

    expect(beforeCalls).toEqual([0]);
    expect(afterCalls).toHaveLength(1);
    expect(afterCalls[0].content[0]).toEqual({ text: "Hello World", type: "text" });
  });
});
