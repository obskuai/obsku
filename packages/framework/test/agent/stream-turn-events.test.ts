import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { InternalPlugin } from "../../src/plugin";
import type { ObskuConfig } from "../../src/services/config";
import type { AgentEvent, LLMProvider, LLMStreamEvent, Message, ToolDef } from "../../src/types";
import { defaultConfig, makeEmit, makePlugin } from "../utils/helpers";
import { runReactLoop, runStreamReactLoop } from "../utils/loop-helpers";
import { textResponse, textStream, toolUseStream } from "../utils/responses";

function makeStreamProvider(
  streamFactory: (
    call: number,
    messages: Array<Message>,
    tools?: Array<ToolDef>
  ) => AsyncIterable<LLMStreamEvent>
): LLMProvider & { getCallCount: () => number } {
  let callCount = 0;
  return {
    async chat(_messages: Array<Message>) {
      return textResponse("unused");
    },
    chatStream(messages: Array<Message>, tools?: Array<ToolDef>) {
      callCount++;
      return streamFactory(callCount, messages, tools);
    },
    getCallCount: () => callCount,
  };
}

describe("StreamStart/StreamEnd events", () => {
  test("emits StreamStart before StreamChunk and StreamEnd after (single turn)", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeStreamProvider(() => textStream(["Hello ", "world"]));

    const result = await Effect.runPromise(
      runStreamReactLoop(
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

    // Find all StreamStart, StreamChunk, and StreamEnd events
    const streamStarts = events.filter((e) => e.type === "stream.start");
    const streamChunks = events.filter((e) => e.type === "stream.chunk");
    const streamEnds = events.filter((e) => e.type === "stream.end");

    // Should have exactly one StreamStart and one StreamEnd for single turn
    expect(streamStarts).toHaveLength(1);
    expect(streamEnds).toHaveLength(1);
    expect(streamChunks).toHaveLength(2);

    // Verify StreamStart comes before StreamChunks
    const streamStartIndex = events.findIndex((e) => e.type === "stream.start");
    const firstChunkIndex = events.findIndex((e) => e.type === "stream.chunk");
    const streamEndIndex = events.findIndex((e) => e.type === "stream.end");

    expect(streamStartIndex).toBeLessThan(firstChunkIndex);
    expect(firstChunkIndex).toBeLessThan(streamEndIndex);

    // Verify turn field is 0 for single turn
    expect((streamStarts[0] as { turn: number }).turn).toBe(0);
    expect((streamEnds[0] as { turn: number }).turn).toBe(0);

    // Verify timestamps are present
    expect((streamStarts[0] as { timestamp: number }).timestamp).toBeGreaterThan(0);
    expect((streamEnds[0] as { timestamp: number }).timestamp).toBeGreaterThan(0);
  });

  test("multi-turn text→tool→text emits correct event sequence", async () => {
    const events: Array<AgentEvent> = [];

    // First call returns text + tool_use, second call returns final text
    const provider = makeStreamProvider((call) => {
      if (call === 1) {
        // Mixed response: text followed by tool_use
        async function* mixedStream(): AsyncIterable<LLMStreamEvent> {
          yield { content: "checking...", type: "text_delta" };
          yield { name: "echo", toolUseId: "t1", type: "tool_use_start" };
          yield { input: JSON.stringify({ text: "hi" }), type: "tool_use_delta" };
          yield { type: "tool_use_end" };
          yield {
            stopReason: "tool_use",
            type: "message_end",
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        return mixedStream();
      }
      // Second call returns final text
      return textStream(["result"]);
    });

    const plugins = new Map<string, InternalPlugin>([["echo", makePlugin("echo", { ok: true })]]);
    const toolDefs: Array<ToolDef> = [
      {
        description: "echo",
        inputSchema: {
          properties: { text: { type: "string" } },
          required: ["text"],
          type: "object",
        },
        name: "echo",
      },
    ];

    const result = await Effect.runPromise(
      runStreamReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        toolDefs,
        plugins,
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events)
      )
    );

    expect(result).toBe("result");
    expect(provider.getCallCount()).toBe(2);

    // Get event sequence
    const eventTypes = events.map((e) => e.type);

    // Verify complete sequence:
    // StreamStart(turn:0) → StreamChunk → StreamEnd(turn:0) → ToolCalling → ToolResult → StreamStart(turn:1) → StreamChunk → StreamEnd(turn:1) → Complete
    const streamStart0Index = eventTypes.indexOf("stream.start");
    const streamEnd0Index = eventTypes.indexOf("stream.end");
    const toolCallingIndex = eventTypes.indexOf("tool.call");
    const toolResultIndex = eventTypes.indexOf("tool.result");
    const streamStart1Index = eventTypes.indexOf("stream.start", streamStart0Index + 1);
    const streamEnd1Index = eventTypes.indexOf("stream.end", streamEnd0Index + 1);
    const completeIndex = eventTypes.indexOf("agent.complete");

    expect(streamStart0Index).toBeGreaterThanOrEqual(0);
    expect(streamEnd0Index).toBeGreaterThan(streamStart0Index);
    expect(toolCallingIndex).toBeGreaterThan(streamEnd0Index);
    expect(toolResultIndex).toBeGreaterThan(toolCallingIndex);
    expect(streamStart1Index).toBeGreaterThan(toolResultIndex);
    expect(streamEnd1Index).toBeGreaterThan(streamStart1Index);
    expect(completeIndex).toBeGreaterThan(streamEnd1Index);

    // Verify turn indices
    const streamStarts = events.filter((e) => e.type === "stream.start");
    const streamEnds = events.filter((e) => e.type === "stream.end");

    expect(streamStarts).toHaveLength(2);
    expect(streamEnds).toHaveLength(2);

    expect((streamStarts[0] as { turn: number }).turn).toBe(0);
    expect((streamStarts[1] as { turn: number }).turn).toBe(1);
    expect((streamEnds[0] as { turn: number }).turn).toBe(0);
    expect((streamEnds[1] as { turn: number }).turn).toBe(1);

    // Verify StreamChunk content
    const streamChunks = events.filter((e) => e.type === "stream.chunk");
    expect(streamChunks).toHaveLength(2);
    expect((streamChunks[0] as { content: string }).content).toBe("checking...");
    expect((streamChunks[1] as { content: string }).content).toBe("result");
  });

  test("non-streaming emits StreamStart/StreamEnd without StreamChunk", async () => {
    const events: Array<AgentEvent> = [];
    const provider: LLMProvider = {
      chat: async () => textResponse("Hello non-streaming"),
      chatStream: async function* () {},
      contextWindowSize: 200_000,
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
        makeEmit(events)
      )
    );

    // Find Stream events
    const streamStarts = events.filter((e) => e.type === "stream.start");
    const streamEnds = events.filter((e) => e.type === "stream.end");
    const streamChunks = events.filter((e) => e.type === "stream.chunk");

    // Should have StreamStart and StreamEnd but NO StreamChunks in non-streaming mode
    expect(streamStarts).toHaveLength(1);
    expect(streamEnds).toHaveLength(1);
    expect(streamChunks).toHaveLength(0);

    // Verify turn field
    expect((streamStarts[0] as { turn: number }).turn).toBe(0);
    expect((streamEnds[0] as { turn: number }).turn).toBe(0);

    // Verify timestamps
    expect((streamStarts[0] as { timestamp: number }).timestamp).toBeGreaterThan(0);
    expect((streamEnds[0] as { timestamp: number }).timestamp).toBeGreaterThan(0);

    // Verify order: StreamStart before StreamEnd
    const streamStartIndex = events.findIndex((e) => e.type === "stream.start");
    const streamEndIndex = events.findIndex((e) => e.type === "stream.end");
    expect(streamStartIndex).toBeLessThan(streamEndIndex);
  });

  test("turn index increments across iterations", async () => {
    const events: Array<AgentEvent> = [];
    const config: ObskuConfig = { ...defaultConfig, maxIterations: 3 };

    // Provider that returns tool_use for first 2 calls, then final response
    const provider = makeStreamProvider((call) => {
      if (call <= 2) {
        return toolUseStream(`t${call}`, "echo", {});
      }
      return textStream(["final"]);
    });

    const plugins = new Map<string, InternalPlugin>([["echo", makePlugin("echo", { ok: true })]]);
    const toolDefs: Array<ToolDef> = [
      {
        description: "echo",
        inputSchema: { properties: {}, required: [], type: "object" },
        name: "echo",
      },
    ];

    const result = await Effect.runPromise(
      runStreamReactLoop(
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

    expect(result).toBe("final");
    expect(provider.getCallCount()).toBe(3);

    // Get all StreamStart and StreamEnd events in order
    const streamEvents = events.filter((e) => e.type === "stream.start" || e.type === "stream.end");

    // Should have 3 StreamStart and 3 StreamEnd (one pair per iteration)
    const streamStarts = streamEvents.filter((e) => e.type === "stream.start");
    const streamEnds = streamEvents.filter((e) => e.type === "stream.end");

    expect(streamStarts).toHaveLength(3);
    expect(streamEnds).toHaveLength(3);

    // Verify turn indices: 0, 1, 2
    const turns = streamStarts.map((e) => (e as { turn: number }).turn);
    expect(turns).toEqual([0, 1, 2]);

    // Verify StreamEnd turn indices match StreamStart
    const endTurns = streamEnds.map((e) => (e as { turn: number }).turn);
    expect(endTurns).toEqual([0, 1, 2]);

    // Verify alternating pattern: Start(0), End(0), Start(1), End(1), Start(2), End(2)
    for (let i = 0; i < 3; i++) {
      expect(streamEvents[i * 2].type).toBe("stream.start");
      expect((streamEvents[i * 2] as { turn: number }).turn).toBe(i);
      expect(streamEvents[i * 2 + 1].type).toBe("stream.end");
      expect((streamEvents[i * 2 + 1] as { turn: number }).turn).toBe(i);
    }
  });
});
