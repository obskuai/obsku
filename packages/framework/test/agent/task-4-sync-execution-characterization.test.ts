import { describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { executeApprovedSyncTools } from "../../src/agent/sync-execution";
import { executeSyncTools } from "../../src/agent/tool-executor";
import type { InternalPlugin } from "../../src/plugin";
import type { AgentEvent, LLMProvider, ToolDef, ToolUseContent } from "../../src/types";
import { defaultAgentDef, defaultConfig, delay, makeEmit } from "../utils/helpers";
import { runReactLoop } from "../utils/loop-helpers";
import { textResponse, toolResponse } from "../utils/responses";

describe("sync execution characterization", () => {
  test("sync execution characterization preserves ToolCalling/result order across overlap and keeps missing-tool envelope shape", async () => {
    const events: Array<AgentEvent> = [];
    const slowPlugin: InternalPlugin = {
      description: "slow success",
      execute: () =>
        Effect.promise(async () => {
          await delay(25);
          return { content: "slow-ok" };
        }),
      name: "slow",
      params: {},
    };

    const calls: Array<ToolUseContent> = [
      {
        input: { job: "first" },
        name: "slow",
        toolUseId: "tu-slow",
        type: "tool_use",
      },
      {
        input: null as unknown as Record<string, unknown>,
        name: "missing",
        toolUseId: "tu-missing",
        type: "tool_use",
      },
    ];

    const result = await Effect.runPromise(
      executeSyncTools(
        calls,
        new Map([["slow", { middleware: [], plugin: slowPlugin }]]),
        defaultAgentDef,
        defaultConfig,
        makeEmit(events)
      )
    );

    expect(events).toEqual([
      {
        args: { job: "first" },
        timestamp: expect.any(Number),
        toolName: "slow",
        toolUseId: "tu-slow",
        type: "tool.call",
      },
      {
        args: {},
        timestamp: expect.any(Number),
        toolName: "missing",
        toolUseId: "tu-missing",
        type: "tool.call",
      },
    ]);

    expect(result).toEqual([
      {
        isError: false,
        result: "slow-ok",
        toolName: "slow",
        toolUseId: "tu-slow",
      },
      {
        isError: true,
        result: JSON.stringify({ error: "Tool not found: missing" }),
        toolName: "missing",
        toolUseId: "tu-missing",
      },
    ]);
  });

  test("sync execution characterization preserves ToolResult event order and error flag when one sync tool is missing", async () => {
    const events: Array<AgentEvent> = [];
    const slowPlugin: InternalPlugin = {
      description: "slow success",
      execute: () =>
        Effect.promise(async () => {
          await delay(25);
          return { content: "slow-ok" };
        }),
      name: "slow",
      params: {},
    };

    const providerCalls: Array<string> = [];
    const provider: LLMProvider = {
      chat: async (messages) => {
        const lastMessage = messages[messages.length - 1];
        providerCalls.push(lastMessage?.role ?? "unknown");
        const hasToolResult = lastMessage?.content.some(
          (content: (typeof lastMessage.content)[number]) => content.type === "tool_result"
        );
        if (hasToolResult) {
          return textResponse("done");
        }
        return toolResponse([
          { id: "tu-slow", input: { job: "first" }, name: "slow" },
          { id: "tu-missing", input: {}, name: "missing" },
        ]);
      },
      chatStream: async function* () {},
      contextWindowSize: 200_000,
    };

    const toolDefs: Array<ToolDef> = [
      {
        description: "slow",
        inputSchema: { properties: { job: { type: "string" } }, required: ["job"], type: "object" },
        name: "slow",
      },
      {
        description: "missing",
        inputSchema: { properties: {}, required: [], type: "object" },
        name: "missing",
      },
    ];

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        toolDefs,
        new Map([["slow", slowPlugin]]),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events)
      )
    );

    expect(result).toBe("done");
    expect(providerCalls).toEqual(["user", "user"]);
    expect(events.map((event) => event.type)).toEqual([
      "turn.start",
      "stream.start",
      "stream.end",
      "turn.end",
      "tool.call",
      "tool.call",
      "tool.result",
      "tool.result",
      "turn.start",
      "stream.start",
      "stream.end",
      "turn.end",
      "agent.thinking",
      "agent.transition",
      "agent.complete",
      "session.end",
    ]);
    expect(events[6]).toEqual({
      isError: false,
      result: "slow-ok",
      timestamp: expect.any(Number),
      toolName: "slow",
      toolUseId: "tu-slow",
      type: "tool.result",
    });
    expect(events[7]).toEqual({
      isError: true,
      result: JSON.stringify({ error: "Tool not found: missing" }),
      timestamp: expect.any(Number),
      toolName: "missing",
      toolUseId: "tu-missing",
      type: "tool.result",
    });
  });

  test("sync execution characterization normalizes object progress chunks into tool.progress events", async () => {
    const events: Array<AgentEvent> = [];
    const progressPlugin: InternalPlugin = {
      description: "progress reporter",
      execute: (_input, onProgress) =>
        Effect.sync(() => {
          onProgress?.({
            current: 1,
            message: "warming",
            percent: 50,
            stage: "scan",
            status: "running",
            total: 2,
          });
          return { result: "done" };
        }),
      name: "progress",
      params: {},
    };

    const result = await Effect.runPromise(
      executeApprovedSyncTools(
        [{ input: {}, name: "progress", toolUseId: "tu-progress", type: "tool_use" }],
        new Map([["progress", { middleware: [], plugin: progressPlugin }]]),
        defaultAgentDef,
        defaultConfig,
        undefined,
        undefined,
        makeEmit(events)
      )
    );

    expect(result).toEqual([
      {
        isError: false,
        result: "done",
        toolName: "progress",
        toolUseId: "tu-progress",
      },
    ]);
    expect(events).toEqual([
      {
        current: 1,
        message: "warming",
        percent: 50,
        stage: "scan",
        status: "running",
        timestamp: expect.any(Number),
        toolName: "progress",
        toolUseId: "tu-progress",
        total: 2,
        type: "tool.progress",
      },
    ]);
  });

  test("sync execution characterization logs bounded progress emit failures without changing tool result flow", async () => {
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    const progressPlugin: InternalPlugin = {
      description: "progress reporter",
      execute: (_input, onProgress) =>
        Effect.sync(() => {
          onProgress?.("warming");
          return { result: "done" };
        }),
      name: "progress",
      params: {},
    };

    const result = await Effect.runPromise(
      executeApprovedSyncTools(
        [{ input: {}, name: "progress", toolUseId: "tu-progress", type: "tool_use" }],
        new Map([["progress", { middleware: [], plugin: progressPlugin }]]),
        defaultAgentDef,
        defaultConfig,
        undefined,
        undefined,
        () => Effect.fail(new Error("emit failed " + "x".repeat(400)))
      )
    );

    await Promise.resolve();

    expect(result).toEqual([
      {
        isError: false,
        result: "done",
        toolName: "progress",
        toolUseId: "tu-progress",
      },
    ]);
    expect(stderrSpy).toHaveBeenCalled();
    const logged = stderrSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain(
      "[obsku:telemetry] tool_progress_emit_error: tool=progress toolUseId=tu-progress error=emit failed"
    );
    expect(logged.length).toBeLessThan(350);
    stderrSpy.mockRestore();
  });
});
