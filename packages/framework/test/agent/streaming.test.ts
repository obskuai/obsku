import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { agent } from "../../src/agent";
import type { LLMProvider, Message, PluginDef, ToolResultContent } from "../../src/types";
import { dummyStream } from "../utils/helpers";

describe("agent + streaming plugin integration", () => {
  test("async generator plugin: final value used as tool_result", async () => {
    const yielded: Array<string> = [];

    const streamPlugin: PluginDef = {
      description: "Streaming tool",
      name: "stream_tool",
      params: z.object({}),
      run: async function* () {
        yielded.push("chunk1");
        yield "chunk1";
        yielded.push("chunk2");
        yield "chunk2";
        yielded.push("final-value");
        yield "final-value";
      },
    };

    let callCount = 0;
    let toolResultContent: string | null = null;

    const mockProvider: LLMProvider = {
      chat: async (messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [{ input: {}, name: "stream_tool", toolUseId: "t1", type: "tool_use" }],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        // Extract tool_result to verify final value
        for (const msg of messages) {
          for (const block of msg.content) {
            if (block.type === "tool_result" && block.toolUseId === "t1") {
              toolResultContent = (block as ToolResultContent).content;
            }
          }
        }
        return {
          content: [{ text: "Stream complete", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 20, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "stream-test",
      prompt: "Test",
      tools: [streamPlugin],
    });

    const result = await a.run("Go", mockProvider);

    expect(result).toBe("Stream complete");
    expect(callCount).toBe(2);

    // All chunks were yielded by the generator
    expect(yielded).toEqual(["chunk1", "chunk2", "final-value"]);

    // Only the final value appears as tool_result
    expect(toolResultContent!).toBe("final-value");
  });

  test("intermediate yields do NOT appear in conversation messages", async () => {
    const streamPlugin: PluginDef = {
      description: "Streaming",
      name: "stream_tool",
      params: z.object({}),
      run: async function* () {
        yield "intermediate-1";
        yield "intermediate-2";
        yield "the-final-result";
      },
    };

    let callCount = 0;
    let allMessages: Array<Message> = [];

    const mockProvider: LLMProvider = {
      chat: async (messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [{ input: {}, name: "stream_tool", toolUseId: "t1", type: "tool_use" }],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        allMessages = [...messages];
        return {
          content: [{ text: "Done", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 20, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({ name: "no-intermediate", prompt: "Test", tools: [streamPlugin] });
    await a.run("Go", mockProvider);

    // Serialize all message content to check what's in the conversation
    const allContent = JSON.stringify(allMessages);

    // Intermediate values should NOT appear anywhere in messages
    expect(allContent).not.toContain("intermediate-1");
    expect(allContent).not.toContain("intermediate-2");

    // Final value SHOULD appear (as tool_result)
    expect(allContent).toContain("the-final-result");
  });

  test("streaming plugin with params works in agent loop", async () => {
    const streamPlugin = {
      description: "Count streamer",
      name: "count_stream",
      params: z.object({ count: z.number() }),
      run: async function* (input) {
        const n = input.count as number;
        for (let i = 1; i <= n; i++) {
          yield `step-${i}`;
        }
        yield `done-${n}`;
      },
    };

    let callCount = 0;
    let toolResultContent: string | null = null;

    const mockProvider: LLMProvider = {
      chat: async (messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [
              { input: { count: 3 }, name: "count_stream", toolUseId: "t1", type: "tool_use" },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        for (const msg of messages) {
          for (const block of msg.content) {
            if (block.type === "tool_result" && block.toolUseId === "t1") {
              toolResultContent = (block as ToolResultContent).content;
            }
          }
        }
        return {
          content: [{ text: "Counted", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 20, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({ name: "param-stream", prompt: "Test", tools: [streamPlugin] });
    const result = await a.run("Count to 3", mockProvider);

    expect(result).toBe("Counted");
    expect(toolResultContent!).toBe("done-3");
  });

  test("streaming plugin error mid-stream → error in tool_result", async () => {
    const errorStream: PluginDef = {
      description: "Fails mid-stream",
      name: "error_stream",
      params: z.object({}),
      run: async function* () {
        yield "chunk1";
        throw new Error("Stream exploded");
      },
    };

    let callCount = 0;
    let toolResultContent: string | null = null;

    const mockProvider: LLMProvider = {
      chat: async (messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [{ input: {}, name: "error_stream", toolUseId: "t1", type: "tool_use" }],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        for (const msg of messages) {
          for (const block of msg.content) {
            if (block.type === "tool_result" && block.toolUseId === "t1") {
              toolResultContent = (block as ToolResultContent).content;
            }
          }
        }
        return {
          content: [{ text: "Error handled", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 20, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({ name: "error-stream-test", prompt: "Test", tools: [errorStream] });
    const result = await a.run("Go", mockProvider);

    expect(result).toBe("Error handled");
    // Error should be captured in tool_result
    const parsed = JSON.parse(toolResultContent!);
    expect(parsed).toHaveProperty("error");
    expect(parsed.error).toContain("Stream exploded");
  });

  test("streaming plugin yielding objects: last object is tool_result", async () => {
    const objectStream: PluginDef = {
      description: "Yields objects",
      name: "object_stream",
      params: z.object({}),
      run: async function* () {
        yield { status: "started" };
        yield { pct: 50, status: "progress" };
        yield { data: [1, 2, 3], status: "complete" };
      },
    };

    let callCount = 0;
    let toolResultContent: string | null = null;

    const mockProvider: LLMProvider = {
      chat: async (messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [{ input: {}, name: "object_stream", toolUseId: "t1", type: "tool_use" }],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        for (const msg of messages) {
          for (const block of msg.content) {
            if (block.type === "tool_result" && block.toolUseId === "t1") {
              toolResultContent = (block as ToolResultContent).content;
            }
          }
        }
        return {
          content: [{ text: "Objects done", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 20, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({ name: "obj-stream", prompt: "Test", tools: [objectStream] });
    await a.run("Go", mockProvider);

    expect(JSON.parse(toolResultContent!)).toEqual({ data: [1, 2, 3], status: "complete" });
  });

  test("mixed streaming + regular plugins in same agent", async () => {
    const streamPlugin: PluginDef = {
      description: "Streams",
      name: "streamer",
      params: z.object({}),
      run: async function* () {
        yield "s1";
        yield "s-final";
      },
    };

    const regularPlugin: PluginDef = {
      description: "Regular",
      name: "regular",
      params: z.object({}),
      run: async () => "regular-result",
    };

    let callCount = 0;
    let streamResult: string | null = null;
    let regularResult: string | null = null;

    const mockProvider: LLMProvider = {
      chat: async (messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          // Call both tools in parallel
          return {
            content: [
              { input: {}, name: "streamer", toolUseId: "t1", type: "tool_use" },
              { input: {}, name: "regular", toolUseId: "t2", type: "tool_use" },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        for (const msg of messages) {
          for (const block of msg.content) {
            if (block.type === "tool_result" && block.toolUseId === "t1") {
              streamResult = (block as ToolResultContent).content;
            }
            if (block.type === "tool_result" && block.toolUseId === "t2") {
              regularResult = (block as ToolResultContent).content;
            }
          }
        }
        return {
          content: [{ text: "Mixed done", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 20, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({ name: "mixed", prompt: "Test", tools: [streamPlugin, regularPlugin] });
    const result = await a.run("Go", mockProvider);

    expect(result).toBe("Mixed done");
    expect(streamResult!).toBe("s-final");
    expect(regularResult!).toBe("regular-result");
  });
});
