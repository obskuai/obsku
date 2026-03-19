import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { z } from "zod";
import { agent } from "../../src/agent";
import { emitBackgroundStartEvents, launchBackgroundTask } from "../../src/agent/background-launch";
import type { ToolExecutionResult } from "../../src/agent/tool-execution-shared";
import { buildBackgroundPlugin, TaskManager } from "../../src/background";
import { plugin as createPlugin } from "../../src/plugin";
import type { LLMProvider, Message, ToolResultContent, ToolUseContent } from "../../src/types";
import { delay, dummyStream } from "../utils/helpers";

function extractTaskId(messages: Array<Message>, toolUseId: string): string | null {
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === "tool_result" && block.toolUseId === toolUseId) {
        try {
          const parsed = JSON.parse((block as ToolResultContent).content);
          if (parsed.taskId) {
            return parsed.taskId as string;
          }
        } catch {
          /* not JSON */
        }
      }
    }
  }
  return null;
}

function hasNotification(messages: Array<Message>, substring: string): boolean {
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === "text" && block.text.includes(substring)) {
        return true;
      }
    }
  }
  return false;
}

describe("agent + background integration", () => {
  test("background launch returns taskId JSON string payload baseline", async () => {
    const manager = new TaskManager();
    const plugin = createPlugin({
      description: "Background baseline",
      name: "bg_baseline",
      params: z.object({ wait: z.boolean().optional() }),
      run: async ({ wait }) => {
        if (wait === true) {
          return "done";
        }
        return { ignored: true };
      },
    });

    const result = launchBackgroundTask(
      { input: {}, name: "bg_baseline", toolUseId: "bg1", type: "tool_use" },
      plugin,
      manager
    );

    expect(result).toEqual({
      isError: false,
      result: expect.stringMatching(/^\{"taskId":"task-[^"]+"\}$/),
      toolName: "bg_baseline",
      toolUseId: "bg1",
    });

    const parsed = JSON.parse(result.result);
    expect(parsed).toEqual({ taskId: expect.any(String) });
  });

  test("background launch missing tool returns JSON string error with nested isError field", () => {
    const result = launchBackgroundTask(
      { input: {}, name: "missing_tool", toolUseId: "bg-missing", type: "tool_use" },
      undefined,
      new TaskManager()
    );

    expect(result).toEqual({
      isError: true,
      result: JSON.stringify({ error: "Tool not found: missing_tool", isError: true }),
      toolName: "missing_tool",
      toolUseId: "bg-missing",
    });
  });

  test("background start parse failures emit parse.error with raw task payload", async () => {
    const emitted: Array<unknown> = [];
    const results: Array<ToolExecutionResult> = [
      {
        isError: false,
        result: JSON.stringify({ wrong: true }),
        toolName: "bg_tool",
        toolUseId: "bg-parse",
      },
    ];
    const backgroundToolCall: ToolUseContent = {
      input: {},
      name: "bg_tool",
      toolUseId: "bg-parse",
      type: "tool_use",
    };
    const callMap = new Map<string, ToolUseContent>([["bg-parse", backgroundToolCall]]);

    await Effect.runPromise(
      emitBackgroundStartEvents(results, callMap, (event) =>
        Effect.sync(() => {
          emitted.push(event);
          return true;
        })
      )
    );

    expect(emitted).toEqual([
      {
        error: "Expected background start payload with string taskId",
        rawInput: JSON.stringify({ wrong: true }),
        timestamp: expect.any(Number),
        toolName: "bg_tool",
        toolUseId: "bg-parse",
        type: "parse.error",
      },
    ]);
  });

  test("multi-turn: fire bg task → notification → get_result → final answer", async () => {
    const bgPlugin = {
      description: "Slow background task",
      name: "slow_task",
      params: z.object({}),
      run: async () => {
        await delay(100);
        return "slow-result-value";
      },
    };

    const fastPlugin = {
      description: "Fast sync task",
      name: "fast_task",
      params: z.object({}),
      run: async () => "fast-result-value",
    };

    const bgWrapped = buildBackgroundPlugin(bgPlugin, new TaskManager());

    let callCount = 0;
    let capturedTaskId: string | null = null;
    let turn3Messages: Array<Message> = [];

    const mockProvider: LLMProvider = {
      chat: async (messages: Array<Message>) => {
        callCount++;

        if (callCount === 1) {
          // Turn 1: call both bg + sync tools
          return {
            content: [
              { input: {}, name: "slow_task", toolUseId: "t1", type: "tool_use" },
              { input: {}, name: "fast_task", toolUseId: "t2", type: "tool_use" },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }

        if (callCount === 2) {
          // Extract taskId returned for the bg tool
          capturedTaskId = extractTaskId(messages, "t1");

          // Delay to let bg task (100ms) complete
          await delay(200);

          return {
            content: [
              {
                input: { taskId: capturedTaskId },
                name: "get_result",
                toolUseId: "t3",
                type: "tool_use",
              },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 20, outputTokens: 5 },
          };
        }

        // Turn 3: capture messages to verify notification injection
        turn3Messages = [...messages];

        return {
          content: [{ text: "Done with all tasks", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 30, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "bg-test-agent",
      prompt: "Test agent with background tasks",
      tools: [bgWrapped, fastPlugin],
    });

    const result = await a.run("Run tasks", mockProvider);

    // Final answer
    expect(result).toBe("Done with all tasks");
    expect(callCount).toBe(3);

    // Task ID was captured
    expect(capturedTaskId).not.toBeNull();
    expect(capturedTaskId).toEqual(expect.any(String));

    // Fast tool result is in messages (as tool_result for t2)
    const fastResult = turn3Messages
      .flatMap((m) => m.content)
      .find((b) => b.type === "tool_result" && b.toolUseId === "t2") as
      | ToolResultContent
      | undefined;
    expect(fastResult).toBeDefined();
    expect(fastResult?.content).toBe("fast-result-value");

    // Bg tool result is a taskId (as tool_result for t1)
    const bgResult = turn3Messages
      .flatMap((m) => m.content)
      .find((b) => b.type === "tool_result" && b.toolUseId === "t1") as
      | ToolResultContent
      | undefined;
    expect(bgResult).toBeDefined();
    const bgParsed = JSON.parse(bgResult!.content);
    expect(bgParsed).toHaveProperty("taskId");

    // get_result returned completed status (as tool_result for t3)
    const getResultResult = turn3Messages
      .flatMap((m) => m.content)
      .find((b) => b.type === "tool_result" && b.toolUseId === "t3") as
      | ToolResultContent
      | undefined;
    expect(getResultResult).toBeDefined();
    const getResultParsed = JSON.parse(getResultResult!.content);
    expect(getResultParsed).toEqual({
      data: "slow-result-value",
      error: null,
      status: "completed",
      success: true,
    });

    // Notification was injected (bg task completed during provider.chat delay)
    expect(hasNotification(turn3Messages, "[System] Background tasks completed")).toBe(true);
    expect(hasNotification(turn3Messages, "use get_result to retrieve")).toBe(true);
  });

  test("bg dispatch is non-blocking: taskId is returned immediately", async () => {
    const slowPlugin = {
      description: "Takes a long time",
      name: "very_slow",
      params: z.object({}),
      run: async () => {
        await delay(5000); // 5 seconds
        return "never-seen-in-test";
      },
    };
    const bgWrapped = buildBackgroundPlugin(slowPlugin, new TaskManager());

    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: async (_messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [{ input: {}, name: "very_slow", toolUseId: "t1", type: "tool_use" }],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        // Immediately return final answer — don't wait for bg
        return {
          content: [{ text: "Dispatched", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 20, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "dispatch-test",
      prompt: "Test",
      tools: [bgWrapped],
    });

    const start = Date.now();
    const result = await a.run("Go", mockProvider);
    const elapsed = Date.now() - start;

    expect(result).toBe("Dispatched");
    // Should complete very quickly (<200ms), not 5s
    expect(elapsed).toBeLessThan(500);
  });

  test("bg+sync parallel: total time ≈ max(sync), not sum", async () => {
    const bgPlugin = {
      description: "500ms bg task",
      name: "bg_500",
      params: z.object({}),
      run: async () => {
        await delay(500);
        return "bg-done";
      },
    };
    const syncPlugin = {
      description: "500ms sync task",
      name: "sync_500",
      params: z.object({}),
      run: async () => {
        await delay(500);
        return "sync-done";
      },
    };

    const bgWrapped = buildBackgroundPlugin(bgPlugin, new TaskManager());

    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [
              { input: {}, name: "bg_500", toolUseId: "t1", type: "tool_use" },
              { input: {}, name: "sync_500", toolUseId: "t2", type: "tool_use" },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        return {
          content: [{ text: "All done", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 20, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "parallel-test",
      prompt: "Test",
      tools: [bgWrapped, syncPlugin],
    });

    const start = Date.now();
    await a.run("Go", mockProvider);
    const elapsed = Date.now() - start;

    // bg is fire-and-forget (non-blocking), sync takes ~500ms
    // Total should be ~500ms, NOT 1000ms (sequential)
    expect(elapsed).toBeGreaterThan(400);
    expect(elapsed).toBeLessThan(800);
  });

  test("bg task failure → get_result returns failed status", async () => {
    const failPlugin = {
      description: "Fails immediately",
      name: "fail_task",
      params: z.object({}),
      run: async () => {
        throw new Error("Task exploded");
      },
    };
    const bgWrapped = buildBackgroundPlugin(failPlugin, new TaskManager());

    let callCount = 0;
    let capturedTaskId: string | null = null;
    let getResultResponse: unknown = null;

    const mockProvider: LLMProvider = {
      chat: async (messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [{ input: {}, name: "fail_task", toolUseId: "t1", type: "tool_use" }],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        if (callCount === 2) {
          capturedTaskId = extractTaskId(messages, "t1");
          // Wait for task to fail
          await delay(50);
          return {
            content: [
              {
                input: { taskId: capturedTaskId },
                name: "get_result",
                toolUseId: "t2",
                type: "tool_use",
              },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 20, outputTokens: 5 },
          };
        }
        // Extract get_result response
        for (const msg of messages) {
          for (const block of msg.content) {
            if (block.type === "tool_result" && block.toolUseId === "t2") {
              getResultResponse = JSON.parse((block as ToolResultContent).content);
            }
          }
        }
        return {
          content: [{ text: "Task failed", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 30, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "fail-test",
      prompt: "Test",
      tools: [bgWrapped],
    });

    const result = await a.run("Go", mockProvider);
    expect(result).toBe("Task failed");
    expect(getResultResponse).toEqual({
      data: null,
      error: 'Plugin "fail_task" failed: Task exploded',
      status: "completed",
      success: false,
    });
  });

  test("get_result with invalid taskId -> not_found", async () => {
    // Need at least one bg tool so get_result is added
    const dummyBg = {
      description: "Dummy",
      name: "dummy_bg",
      params: z.object({}),
      run: async () => "x",
    };
    const bgWrapped = buildBackgroundPlugin(dummyBg, new TaskManager());

    let callCount = 0;
    let getResultResponse: unknown = null;

    const mockProvider: LLMProvider = {
      chat: async (messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [
              {
                input: { taskId: "task-nonexist" },
                name: "get_result",
                toolUseId: "t1",
                type: "tool_use",
              },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        for (const msg of messages) {
          for (const block of msg.content) {
            if (block.type === "tool_result" && block.toolUseId === "t1") {
              getResultResponse = JSON.parse((block as ToolResultContent).content);
            }
          }
        }
        return {
          content: [{ text: "Not found", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 20, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "notfound-test",
      prompt: "Test",
      tools: [bgWrapped],
    });

    await a.run("Go", mockProvider);
    expect(getResultResponse).toEqual({
      data: null,
      error: "Task not found: task-nonexist",
      status: "not_found",
      success: false,
    });
  });

  test("get_result before completion → running status", async () => {
    const slowPlugin = {
      description: "Slow",
      name: "slow_bg",
      params: z.object({}),
      run: async () => {
        await delay(2000);
        return "eventually";
      },
    };
    const bgWrapped = buildBackgroundPlugin(slowPlugin, new TaskManager());

    let callCount = 0;
    let capturedTaskId: string | null = null;
    let getResultResponse: unknown = null;

    const mockProvider: LLMProvider = {
      chat: async (messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [{ input: {}, name: "slow_bg", toolUseId: "t1", type: "tool_use" }],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        if (callCount === 2) {
          capturedTaskId = extractTaskId(messages, "t1");
          // DON'T wait — check immediately while still running
          return {
            content: [
              {
                input: { taskId: capturedTaskId },
                name: "get_result",
                toolUseId: "t2",
                type: "tool_use",
              },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 20, outputTokens: 5 },
          };
        }
        for (const msg of messages) {
          for (const block of msg.content) {
            if (block.type === "tool_result" && block.toolUseId === "t2") {
              getResultResponse = JSON.parse((block as ToolResultContent).content);
            }
          }
        }
        return {
          content: [{ text: "Still running", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 30, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "running-test",
      prompt: "Test",
      tools: [bgWrapped],
    });

    const start = Date.now();
    await a.run("Go", mockProvider);
    const elapsed = Date.now() - start;

    expect(getResultResponse).toMatchObject({
      data: null,
      error: null,
      status: "running",
      success: false,
    });
    expect(getResultResponse).toHaveProperty("startedAt");
    // Agent should finish quickly, not wait for 2s bg task
    expect(elapsed).toBeLessThan(500);
  });

  test("multiple bg tasks in parallel", async () => {
    const bg1 = {
      description: "BG 1",
      name: "bg_one",
      params: z.object({}),
      run: async () => {
        await delay(80);
        return "result-one";
      },
    };
    const bg2 = {
      description: "BG 2",
      name: "bg_two",
      params: z.object({}),
      run: async () => {
        await delay(80);
        return "result-two";
      },
    };

    const bgWrapped1 = buildBackgroundPlugin(bg1, new TaskManager());
    const bgWrapped2 = buildBackgroundPlugin(bg2, new TaskManager());

    let callCount = 0;
    let taskId1: string | null = null;
    let taskId2: string | null = null;
    let result1: unknown = null;
    let result2: unknown = null;

    const mockProvider: LLMProvider = {
      chat: async (messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          // Fire both bg tasks
          return {
            content: [
              { input: {}, name: "bg_one", toolUseId: "t1", type: "tool_use" },
              { input: {}, name: "bg_two", toolUseId: "t2", type: "tool_use" },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        if (callCount === 2) {
          taskId1 = extractTaskId(messages, "t1");
          taskId2 = extractTaskId(messages, "t2");
          // Wait for both to complete
          await delay(200);
          return {
            content: [
              {
                input: { taskId: taskId1 },
                name: "get_result",
                toolUseId: "t3",
                type: "tool_use",
              },
              {
                input: { taskId: taskId2 },
                name: "get_result",
                toolUseId: "t4",
                type: "tool_use",
              },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 20, outputTokens: 5 },
          };
        }
        for (const msg of messages) {
          for (const block of msg.content) {
            if (block.type === "tool_result" && block.toolUseId === "t3") {
              result1 = JSON.parse((block as ToolResultContent).content);
            }
            if (block.type === "tool_result" && block.toolUseId === "t4") {
              result2 = JSON.parse((block as ToolResultContent).content);
            }
          }
        }
        return {
          content: [{ text: "Both done", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 30, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "multi-bg-test",
      prompt: "Test",
      tools: [bgWrapped1, bgWrapped2],
    });

    const resultText = await a.run("Go", mockProvider);
    expect(resultText).toBe("Both done");

    // Both task IDs are different
    expect(taskId1).not.toBeNull();
    expect(taskId2).not.toBeNull();
    expect(taskId1).not.toBe(taskId2);

    // Both returned completed
    expect(result1).toEqual({
      data: "result-one",
      error: null,
      status: "completed",
      success: true,
    });
    expect(result2).toEqual({
      data: "result-two",
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("get_result auto-added only when agent has bg tools", async () => {
    // Agent with NO bg tools should NOT have get_result
    const syncTool = {
      description: "Sync tool",
      name: "sync_only",
      params: z.object({}),
      run: async () => "sync-result",
    };

    let receivedTools: Array<unknown> = [];
    const mockProvider: LLMProvider = {
      chat: async (_messages: Array<Message>, tools) => {
        receivedTools = tools ?? [];
        return {
          content: [{ text: "Done", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({ name: "no-bg", prompt: "Test", tools: [syncTool] });
    await a.run("Go", mockProvider);

    // No get_result tool should be present
    const toolNames = (receivedTools as Array<{ name: string }>).map((t) => t.name);
    expect(toolNames).toContain("sync_only");
    expect(toolNames).not.toContain("get_result");
  });

  test("get_result auto-added when agent has bg tools", async () => {
    const bgPlugin = {
      description: "BG",
      name: "bg_tool",
      params: z.object({}),
      run: async () => "x",
    };
    const bgWrapped = buildBackgroundPlugin(bgPlugin, new TaskManager());

    let receivedTools: Array<unknown> = [];
    const mockProvider: LLMProvider = {
      chat: async (_messages: Array<Message>, tools) => {
        receivedTools = tools ?? [];
        return {
          content: [{ text: "Done", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({ name: "with-bg", prompt: "Test", tools: [bgWrapped] });
    await a.run("Go", mockProvider);

    const toolNames = (receivedTools as Array<{ name: string }>).map((t) => t.name);
    expect(toolNames).toContain("bg_tool");
    expect(toolNames).toContain("get_result");
  });
});
