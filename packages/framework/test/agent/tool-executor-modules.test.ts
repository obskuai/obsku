import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { emitBackgroundStartEvents, launchBackgroundTask } from "../../src/agent/background-launch";
import { normalizeToolResult } from "../../src/agent/result-normalization";
import { executeApprovedSyncTools } from "../../src/agent/sync-execution";
import { createToolExecutionResult } from "../../src/agent/tool-execution-shared";
import type { EmitFn } from "../../src/agent/tool-executor";
import { TaskManager } from "../../src/background";
import type { InternalPlugin } from "../../src/plugin";
import type { AgentEvent, ToolUseContent } from "../../src/types";
import { defaultAgentDef, defaultConfig } from "../utils/helpers";

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
  return {
    emit: (event) => {
      events.push(event);
      return Effect.succeed(true);
    },
    events,
  };
}

describe("tool executor extracted modules", () => {
  test("result-normalization maps ToolOutput payloads", () => {
    expect(normalizeToolResult({ content: "done", isError: true })).toEqual({
      isError: true,
      result: "done",
    });
    expect(normalizeToolResult({ result: "ok" })).toEqual({
      isError: false,
      result: "ok",
    });
    expect(normalizeToolResult({ nope: true })).toBeNull();
  });

  test("result-normalization still ignores canonical envelopes", () => {
    expect(
      normalizeToolResult({ data: { ok: true }, error: null, status: "completed", success: true })
    ).toBeNull();
    expect(
      normalizeToolResult({ data: null, error: "boom", status: "failed", success: false })
    ).toBeNull();
  });

  test("normalizeToolResult returns null for unrecognized shapes", () => {
    expect(normalizeToolResult(null)).toBeNull();
    expect(normalizeToolResult(undefined)).toBeNull();
    expect(normalizeToolResult(42)).toBeNull();
    expect(normalizeToolResult("string")).toBeNull();
    expect(normalizeToolResult([1, 2, 3])).toBeNull();
    expect(normalizeToolResult({ foo: "bar" })).toBeNull();
    expect(normalizeToolResult({})).toBeNull();
  });

  test("normalizeToolResult handles ToolExecutionResult shape", () => {
    const toolResult = {
      isError: false,
      result: "success output",
      toolName: "test-tool",
      toolUseId: "tu-123",
    };
    expect(normalizeToolResult(toolResult)).toEqual({
      isError: false,
      result: "success output",
    });
  });

  test("normalizeToolResult handles ToolExecutionPayload with isError", () => {
    expect(normalizeToolResult({ isError: true, result: "error output" })).toEqual({
      isError: true,
      result: "error output",
    });
    expect(normalizeToolResult({ isError: false, result: "success output" })).toEqual({
      isError: false,
      result: "success output",
    });
  });

  test("normalizeToolResult handles ToolOutput with default isError=false", () => {
    expect(normalizeToolResult({ content: "output" })).toEqual({
      isError: false,
      result: "output",
    });
    expect(normalizeToolResult({ content: "error", isError: true })).toEqual({
      isError: true,
      result: "error",
    });
  });

  test("normalizeToolResult handles ToolExecutionPayload without explicit isError", () => {
    expect(normalizeToolResult({ result: "output" })).toEqual({
      isError: false,
      result: "output",
    });
  });

  test("normalizeToolResult ignores extra properties on ToolOutput", () => {
    expect(normalizeToolResult({ content: "test", extra: "ignored" })).toBeNull();
    expect(normalizeToolResult({ content: "test", extra: "ignored", isError: false })).toBeNull();
  });

  test("normalizeToolResult handles edge cases for ToolOutput detection", () => {
    // Missing content property
    expect(normalizeToolResult({ isError: false })).toBeNull();
    // Content is not a string
    expect(normalizeToolResult({ content: 123 })).toBeNull();
    expect(normalizeToolResult({ content: null })).toBeNull();
  });

  test("normalizeToolResult preserves isError value from ToolExecutionResult", () => {
    const errorResult = {
      isError: true,
      result: "error occurred",
      toolName: "error-tool",
      toolUseId: "tu-error",
    };
    expect(normalizeToolResult(errorResult)).toEqual({
      isError: true,
      result: "error occurred",
    });
  });

  test("sync-execution keeps missing tool errors inside results", async () => {
    const resolvedTools = new Map([
      [
        "echo",
        {
          middleware: [],
          plugin: {
            description: "echo",
            execute: () => Effect.succeed({ result: JSON.stringify({ ok: true }) }),
            name: "echo",
            params: {},
          } as InternalPlugin,
        },
      ],
    ]);

    const exit = await Effect.runPromiseExit(
      executeApprovedSyncTools(
        [makeToolCall("echo"), makeToolCall("missing")],
        resolvedTools,
        defaultAgentDef,
        defaultConfig
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(2);
      expect(exit.value.find((result) => result.toolName === "missing")?.isError).toBe(true);
    }
  });

  test("background-launch returns task ids and emits start events", async () => {
    const taskManager = new TaskManager();
    const tc = makeToolCall("scanner");
    const plugin: InternalPlugin = {
      description: "scanner",
      execute: () => Effect.succeed("done"),
      name: "scanner",
      params: {},
    };
    const result = launchBackgroundTask(tc, plugin, taskManager);
    const { emit, events } = captureEmit();

    await Effect.runPromise(
      emitBackgroundStartEvents([result], new Map([[tc.toolUseId, tc]]), emit)
    );

    expect(JSON.parse(result.result)).toEqual({ taskId: expect.stringMatching(/^task-/) });
    expect(events.find((event) => event.type === "bg.task.started")).toBeDefined();
  });

  test("parse-error emits tool context for malformed background start payload", async () => {
    const tc = makeToolCall("scanner", {}, "tu-bg");
    const { emit, events } = captureEmit();

    await Effect.runPromise(
      emitBackgroundStartEvents(
        [createToolExecutionResult(tc, '{"taskId":')],
        new Map([[tc.toolUseId, tc]]),
        emit
      )
    );

    expect(events).toEqual([
      {
        error: expect.stringContaining("JSON"),
        rawInput: '{"taskId":',
        timestamp: expect.any(Number),
        toolName: "scanner",
        toolUseId: "tu-bg",
        type: "parse.error",
      },
    ]);
  });
});
