// Unit tests for stream-mapper.ts
// Tests mapStreamEvents generator function

import { describe, expect, test } from "bun:test";
import type { LLMStreamEvent } from "@obsku/framework";
import type { TextStreamPart, ToolSet } from "ai";
import { AiSdkError } from "../src/errors";
import { mapStreamEvents } from "../src/stream-mapper";

function asStreamPart(event: unknown): TextStreamPart<ToolSet> {
  return event as TextStreamPart<ToolSet>;
}

// Helper to create a mock async iterable
async function* mockStream(
  events: Array<TextStreamPart<ToolSet>>
): AsyncIterable<TextStreamPart<ToolSet>> {
  for (const event of events) {
    yield event;
  }
}

// Helper to collect all events from the async iterable
async function collectEvents(
  stream: AsyncIterable<LLMStreamEvent>
): Promise<Array<LLMStreamEvent>> {
  const events: Array<LLMStreamEvent> = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// text-delta events
// ---------------------------------------------------------------------------
describe("mapStreamEvents", () => {
  describe("text-delta event mapping", () => {
    test("maps text-delta to text_delta event", async () => {
      const inputStream = mockStream([
        { type: "text-delta", textDelta: "Hello" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "text_delta", content: "Hello" });
    });

    test("maps multiple text-delta events in sequence", async () => {
      const inputStream = mockStream([
        { type: "text-delta", textDelta: "Hello" } as TextStreamPart<ToolSet>,
        { type: "text-delta", textDelta: " " } as TextStreamPart<ToolSet>,
        { type: "text-delta", textDelta: "world" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(3);
      expect(events[0].type).toBe("text_delta");
      expect(events[1].type).toBe("text_delta");
      expect(events[2].type).toBe("text_delta");
    });

    test("handles empty text delta", async () => {
      const inputStream = mockStream([
        { type: "text-delta", textDelta: "" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "text_delta", content: "" });
    });
  });

  // ---------------------------------------------------------------------------
  // tool-call event mapping
  // ---------------------------------------------------------------------------
  describe("tool-call event mapping", () => {
    test("maps tool-call to start/delta/end sequence", async () => {
      const inputStream = mockStream([
        {
          type: "tool-call",
          toolCallId: "call-123",
          toolName: "echo",
          args: { text: "hello" },
        } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({
        type: "tool_use_start",
        name: "echo",
        toolUseId: "call-123",
      });
      expect(events[1]).toEqual({
        type: "tool_use_delta",
        input: JSON.stringify({ text: "hello" }),
      });
      expect(events[2]).toEqual({ type: "tool_use_end" });
    });

    test("maps tool name to name field", async () => {
      const inputStream = mockStream([
        {
          type: "tool-call",
          toolCallId: "id",
          toolName: "my_custom_tool",
          args: {},
        } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events[0]).toEqual({
        type: "tool_use_start",
        name: "my_custom_tool",
        toolUseId: "id",
      });
    });

    test("maps toolCallId to toolUseId", async () => {
      const inputStream = mockStream([
        {
          type: "tool-call",
          toolCallId: "unique-call-id-456",
          toolName: "tool",
          args: {},
        } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events[0]).toEqual({
        type: "tool_use_start",
        name: "tool",
        toolUseId: "unique-call-id-456",
      });
    });

    test("serializes args to JSON string for delta", async () => {
      const complexArgs = {
        nested: { foo: "bar" },
        array: [1, 2, 3],
        string: "value",
      };
      const inputStream = mockStream([
        {
          type: "tool-call",
          toolCallId: "id",
          toolName: "tool",
          args: complexArgs,
        } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events[1].type).toBe("tool_use_delta");
      expect((events[1] as { input: string }).input).toBe(JSON.stringify(complexArgs));
    });

    test("handles multiple tool calls in sequence", async () => {
      const inputStream = mockStream([
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "tool1",
          args: {},
        } as TextStreamPart<ToolSet>,
        {
          type: "tool-call",
          toolCallId: "call-2",
          toolName: "tool2",
          args: {},
        } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      // Each tool call produces 3 events
      expect(events).toHaveLength(6);
      // First tool call
      expect(events[0]).toEqual({ type: "tool_use_start", name: "tool1", toolUseId: "call-1" });
      expect(events[2]).toEqual({ type: "tool_use_end" });
      // Second tool call
      expect(events[3]).toEqual({ type: "tool_use_start", name: "tool2", toolUseId: "call-2" });
      expect(events[5]).toEqual({ type: "tool_use_end" });
    });
  });

  // ---------------------------------------------------------------------------
  // finish event mapping
  // ---------------------------------------------------------------------------
  describe("finish event mapping", () => {
    test("maps finish to message_end with usage", async () => {
      const inputStream = mockStream([
        {
          type: "finish",
          finishReason: "stop",
          usage: { promptTokens: 100, completionTokens: 50 },
        } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "message_end",
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
      });
    });

    test("maps finishReason 'stop' to 'end_turn'", async () => {
      const inputStream = mockStream([
        { type: "finish", finishReason: "stop" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events[0]).toEqual({
        type: "message_end",
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    });

    test("maps finishReason 'tool-calls' to 'tool_use'", async () => {
      const inputStream = mockStream([
        { type: "finish", finishReason: "tool-calls" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events[0]).toEqual({
        type: "message_end",
        stopReason: "tool_use",
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    });

    test("maps finishReason 'length' to 'max_tokens'", async () => {
      const inputStream = mockStream([
        { type: "finish", finishReason: "length" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events[0]).toEqual({
        type: "message_end",
        stopReason: "max_tokens",
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    });

    test("handles undefined finishReason", async () => {
      const inputStream = mockStream([asStreamPart({ type: "finish", finishReason: undefined })]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events[0]).toEqual({
        type: "message_end",
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    });

    test("maps promptTokens to inputTokens", async () => {
      const inputStream = mockStream([
        {
          type: "finish",
          usage: { promptTokens: 200, completionTokens: 0 },
        } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect((events[0] as { usage: { inputTokens: number } }).usage.inputTokens).toBe(200);
    });

    test("maps completionTokens to outputTokens", async () => {
      const inputStream = mockStream([
        {
          type: "finish",
          usage: { promptTokens: 0, completionTokens: 75 },
        } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect((events[0] as { usage: { outputTokens: number } }).usage.outputTokens).toBe(75);
    });

    test("handles missing usage", async () => {
      const inputStream = mockStream([
        { type: "finish", finishReason: "stop" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect((events[0] as { usage: { inputTokens: number; outputTokens: number } }).usage).toEqual(
        {
          inputTokens: 0,
          outputTokens: 0,
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // error handling
  // ---------------------------------------------------------------------------
  describe("error handling", () => {
    test("throws mapped ProviderError on error event", async () => {
      const inputStream = mockStream([
        { type: "error", error: new Error("API error") } as TextStreamPart<ToolSet>,
      ]);
      await expect(collectEvents(mapStreamEvents(inputStream))).rejects.toThrow(AiSdkError);
    });

    test("preserves error message from error event", async () => {
      const inputStream = mockStream([
        { type: "error", error: new Error("Custom error message") } as TextStreamPart<ToolSet>,
      ]);
      try {
        await collectEvents(mapStreamEvents(inputStream));
        throw new Error("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AiSdkError);
        expect((err as Error).message).toBe("Custom error message");
      }
    });

    test("maps rate limit error correctly", async () => {
      const rateLimitError = { statusCode: 429, message: "Rate limited" };
      const inputStream = mockStream([
        { type: "error", error: rateLimitError } as TextStreamPart<ToolSet>,
      ]);
      try {
        await collectEvents(mapStreamEvents(inputStream));
        throw new Error("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AiSdkError);
        expect((err as AiSdkError).code).toBe("throttle");
      }
    });

    test("maps auth error correctly", async () => {
      const authError = { statusCode: 401, message: "Unauthorized" };
      const inputStream = mockStream([
        { type: "error", error: authError } as TextStreamPart<ToolSet>,
      ]);
      try {
        await collectEvents(mapStreamEvents(inputStream));
        throw new Error("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AiSdkError);
        expect((err as AiSdkError).code).toBe("auth");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // ignored events
  // ---------------------------------------------------------------------------
  describe("ignored events", () => {
    test("ignores reasoning events", async () => {
      const inputStream = mockStream([
        { type: "reasoning", textDelta: "thinking..." } as TextStreamPart<ToolSet>,
        { type: "text-delta", textDelta: "Hello" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("text_delta");
    });

    test("ignores reasoning-signature events", async () => {
      const inputStream = mockStream([
        { type: "reasoning-signature", signature: "sig" } as TextStreamPart<ToolSet>,
        { type: "text-delta", textDelta: "Hello" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(1);
    });

    test("ignores redacted-reasoning events", async () => {
      const inputStream = mockStream([
        { type: "redacted-reasoning", data: "redacted" } as TextStreamPart<ToolSet>,
        { type: "text-delta", textDelta: "Hello" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(1);
    });

    test("ignores source events", async () => {
      const inputStream = mockStream([
        { type: "source", source: {} } as TextStreamPart<ToolSet>,
        { type: "text-delta", textDelta: "Hello" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(1);
    });

    test("ignores file events", async () => {
      const inputStream = mockStream([
        asStreamPart({ type: "file", data: "file data" }),
        { type: "text-delta", textDelta: "Hello" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(1);
    });

    test("ignores tool-call-streaming-start events", async () => {
      const inputStream = mockStream([
        { type: "tool-call-streaming-start", toolCallId: "id" } as TextStreamPart<ToolSet>,
        { type: "text-delta", textDelta: "Hello" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(1);
    });

    test("ignores tool-call-delta events", async () => {
      const inputStream = mockStream([
        {
          type: "tool-call-delta",
          toolCallId: "id",
          argsTextDelta: "delta",
        } as TextStreamPart<ToolSet>,
        { type: "text-delta", textDelta: "Hello" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(1);
    });

    test("ignores tool-result events", async () => {
      const inputStream = mockStream([
        asStreamPart({ type: "tool-result", toolCallId: "id", result: "result" }),
        { type: "text-delta", textDelta: "Hello" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(1);
    });

    test("ignores step-start events", async () => {
      const inputStream = mockStream([
        { type: "step-start" } as TextStreamPart<ToolSet>,
        { type: "text-delta", textDelta: "Hello" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(1);
    });

    test("ignores step-finish events", async () => {
      const inputStream = mockStream([
        { type: "step-finish" } as TextStreamPart<ToolSet>,
        { type: "text-delta", textDelta: "Hello" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(1);
    });

    test("ignores unknown event types", async () => {
      const inputStream = mockStream([
        asStreamPart({ type: "unknown-event" }),
        { type: "text-delta", textDelta: "Hello" } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // full stream sequence
  // ---------------------------------------------------------------------------
  describe("full stream sequence", () => {
    test("handles complete text response stream", async () => {
      const inputStream = mockStream([
        { type: "text-delta", textDelta: "Hello" } as TextStreamPart<ToolSet>,
        { type: "text-delta", textDelta: " world" } as TextStreamPart<ToolSet>,
        {
          type: "finish",
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 5 },
        } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ type: "text_delta", content: "Hello" });
      expect(events[1]).toEqual({ type: "text_delta", content: " world" });
      expect(events[2]).toEqual({
        type: "message_end",
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      });
    });

    test("handles complete tool call stream", async () => {
      const inputStream = mockStream([
        { type: "text-delta", textDelta: "Using tool" } as TextStreamPart<ToolSet>,
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "search",
          args: { query: "test" },
        } as TextStreamPart<ToolSet>,
        {
          type: "finish",
          finishReason: "tool-calls",
          usage: { promptTokens: 15, completionTokens: 20 },
        } as TextStreamPart<ToolSet>,
      ]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(5);
      // text-delta
      expect(events[0].type).toBe("text_delta");
      // tool_use_start, tool_use_delta, tool_use_end
      expect(events[1].type).toBe("tool_use_start");
      expect(events[2].type).toBe("tool_use_delta");
      expect(events[3].type).toBe("tool_use_end");
      // message_end
      expect(events[4]).toEqual({
        type: "message_end",
        stopReason: "tool_use",
        usage: { inputTokens: 15, outputTokens: 20 },
      });
    });

    test("handles empty stream", async () => {
      const inputStream = mockStream([]);
      const events = await collectEvents(mapStreamEvents(inputStream));
      expect(events).toHaveLength(0);
    });
  });
});
