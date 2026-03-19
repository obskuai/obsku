import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { TaskManager } from "../../src/background";
import type { InternalPlugin } from "../../src/plugin";
import type { ObskuConfig } from "../../src/services/config";
import type { AgentEvent, Message, ToolDef } from "../../src/types";
import { defaultConfig, makeEmit, makePlugin, makeProvider } from "../utils/helpers";
import { runReactLoop } from "../utils/loop-helpers";
import { mixedResponse, textResponse, toolResponse } from "../utils/responses";

describe("runReactLoop", () => {
  test("returns text when LLM responds without tool calls", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeProvider(async () => textResponse("Hello world"));

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

    expect(result).toBe("Hello world");
  });

  test("dispatches tool calls and feeds results back to LLM", async () => {
    const events: Array<AgentEvent> = [];
    let callCount = 0;
    const provider = makeProvider(async () => {
      callCount++;
      if (callCount === 1) {
        return toolResponse([{ id: "t1", input: { text: "hi" }, name: "echo" }]);
      }
      return textResponse("Tool result processed");
    });

    const plugins = new Map<string, InternalPlugin>([
      ["echo", makePlugin("echo", { echoed: "hi" })],
    ]);

    const toolDefs: Array<ToolDef> = [
      {
        description: "echo tool",
        inputSchema: {
          properties: { text: { type: "string" } },
          required: ["text"],
          type: "object",
        },
        name: "echo",
      },
    ];

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "echo hi", type: "text" }], role: "user" }],
        toolDefs,
        plugins,
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events)
      )
    );

    expect(result).toBe("Tool result processed");
    expect(callCount).toBe(2);
    expect(events.some((e) => e.type === "tool.call")).toBe(true);
    expect(events.some((e) => e.type === "tool.result")).toBe(true);
  });

  test("stops at maxIterations and returns last text", async () => {
    const events: Array<AgentEvent> = [];
    let callCount = 0;
    const provider = makeProvider(async () => {
      callCount++;
      return mixedResponse(`iter ${callCount}`, [{ id: `t${callCount}`, name: "echo" }]);
    });

    const plugins = new Map<string, InternalPlugin>([["echo", makePlugin("echo")]]);
    const toolDefs: Array<ToolDef> = [
      {
        description: "echo",
        inputSchema: { properties: {}, required: [], type: "object" },
        name: "echo",
      },
    ];

    const config: ObskuConfig = { ...defaultConfig, maxIterations: 3 };

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "go", type: "text" }], role: "user" }],
        toolDefs,
        plugins,
        provider,
        config,
        new Set(),
        undefined,
        makeEmit(events)
      )
    );

    expect(callCount).toBe(3);
    expect(result).toBe("iter 3");
  });

  test("emits Complete event with summary text", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeProvider(async () => textResponse("final summary"));

    await Effect.runPromise(
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

    const completeEvents = events.filter((e) => e.type === "agent.complete");
    expect(completeEvents).toHaveLength(1);
    expect((completeEvents[0] as { summary: string; type: "agent.complete" }).summary).toBe(
      "final summary"
    );
  });

  test("calls taskManager.cleanup() when taskManager provided", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeProvider(async () => textResponse("done"));
    const taskManager = new TaskManager();

    let cleanupCalled = false;
    const origCleanup = taskManager.cleanup.bind(taskManager);
    taskManager.cleanup = () => {
      cleanupCalled = true;
      return origCleanup();
    };

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        taskManager,
        makeEmit(events)
      )
    );

    expect(cleanupCalled).toBe(true);
  });

  test("does not call cleanup when no taskManager", async () => {
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

  test("handles background notifications from taskManager", async () => {
    const events: Array<AgentEvent> = [];
    const messages: Array<Message> = [{ content: [{ text: "hi", type: "text" }], role: "user" }];

    const fakeTaskManager = {
      cleanup: () => 0,
      getCompletedSince: (_ts: number) => [
        {
          completedAt: Date.now(),
          id: "task-abc",
          pluginName: "bg-tool",
          startedAt: 0,
          state: "completed" as const,
        },
      ],
      start: () => "",
    } as unknown as TaskManager;

    const provider = makeProvider(async () => textResponse("got it"));

    await Effect.runPromise(
      runReactLoop(
        messages,
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        fakeTaskManager,
        makeEmit(events)
      )
    );

    const notifMessages = messages.filter((m) =>
      m.content.some(
        (c) =>
          c.type === "text" &&
          (c as { text: string; type: "text" }).text.includes("[System] Background tasks completed")
      )
    );
    expect(notifMessages.length).toBeGreaterThanOrEqual(1);
  });

  test("separates background and sync tool calls correctly", async () => {
    const events: Array<AgentEvent> = [];
    let callCount = 0;
    const provider = makeProvider(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: [
            { input: {}, name: "sync-tool", toolUseId: "s1", type: "tool_use" as const },
            { input: {}, name: "bg-tool", toolUseId: "b1", type: "tool_use" as const },
          ],
          stopReason: "tool_use" as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      }
      return textResponse("all done");
    });

    const syncPlugin = makePlugin("sync-tool", { sync: true });
    const bgPlugin = makePlugin("bg-tool", { bg: true });
    const plugins = new Map<string, InternalPlugin>([
      ["sync-tool", syncPlugin],
      ["bg-tool", bgPlugin],
    ]);

    const toolDefs: Array<ToolDef> = [
      {
        description: "sync",
        inputSchema: { properties: {}, required: [], type: "object" },
        name: "sync-tool",
      },
      {
        description: "bg",
        inputSchema: { properties: {}, required: [], type: "object" },
        name: "bg-tool",
      },
    ];

    const taskManager = new TaskManager();
    const bgToolNames = new Set(["bg-tool"]);

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "run both", type: "text" }], role: "user" }],
        toolDefs,
        plugins,
        provider,
        defaultConfig,
        bgToolNames,
        taskManager,
        makeEmit(events)
      )
    );

    expect(result).toBe("all done");
    expect(callCount).toBe(2);

    const toolResults = events.filter((e) => e.type === "tool.result");
    expect(toolResults.some((e) => (e as { toolName: string }).toolName === "sync-tool")).toBe(
      true
    );

    const bgStarted = events.filter((e) => e.type === "bg.task.started");
    expect(bgStarted.length).toBeGreaterThanOrEqual(1);
  });
});
