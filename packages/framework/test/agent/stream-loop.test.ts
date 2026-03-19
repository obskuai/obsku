import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamingStrategy } from "../../src/agent/stream-loop";
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
    contextWindowSize: 200_000,
    getCallCount: () => callCount,
  };
}

async function* chunkedToolUseStream(
  toolUseId: string,
  name: string,
  chunks: Array<string>
): AsyncIterable<LLMStreamEvent> {
  yield { name, toolUseId, type: "tool_use_start" };
  for (const input of chunks) {
    yield { input, type: "tool_use_delta" };
  }
  yield { type: "tool_use_end" };
  yield {
    stopReason: "tool_use",
    type: "message_end",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

async function runStreamingStrategyOnce(stream: AsyncIterable<LLMStreamEvent>) {
  const events: Array<AgentEvent> = [];
  const provider = makeStreamProvider(() => stream);

  const result = await Effect.runPromise(
    streamingStrategy(
      provider,
      [{ content: [{ text: "hi", type: "text" }], role: "user" }],
      [],
      undefined,
      makeEmit(events)
    )
  );

  return { events, result };
}

describe("runStreamReactLoop", () => {
  test("emits StreamChunk events for each text_delta", async () => {
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
    const chunks = events.filter((e) => e.type === "stream.chunk");
    expect(chunks).toHaveLength(2);
    expect(chunks.map((e) => (e as { content: string }).content)).toEqual(["Hello ", "world"]);
  });

  test("concatenated StreamChunk content equals final result", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeStreamProvider(() => textStream(["A", "B", "C"]));

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

    const chunkText = events
      .filter((e) => e.type === "stream.chunk")
      .map((e) => (e as { content: string }).content)
      .join("");

    expect(chunkText).toBe(result);
  });

  test("tool calls work in streaming mode", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeStreamProvider((call) => {
      if (call === 1) {
        return toolUseStream("t1", "echo", { text: "hi" });
      }
      return textStream(["done"]);
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

    expect(result).toBe("done");
    expect(provider.getCallCount()).toBe(2);
    expect(events.some((e) => e.type === "tool.call")).toBe(true);
    expect(events.some((e) => e.type === "tool.result")).toBe(true);
  });

  test("non-streaming loop does NOT emit StreamChunk", async () => {
    const events: Array<AgentEvent> = [];
    const provider: LLMProvider = {
      chat: async () => textResponse("Hello"),
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

    expect(events.some((e) => e.type === "stream.chunk")).toBe(false);
  });

  test("streaming loop respects maxIterations", async () => {
    const events: Array<AgentEvent> = [];
    const config: ObskuConfig = { ...defaultConfig, maxIterations: 2 };

    const provider = makeStreamProvider((call) => {
      async function* stream(): AsyncIterable<LLMStreamEvent> {
        yield { content: `iter ${call}`, type: "text_delta" };
        yield* toolUseStream(`t${call}`, "echo", {});
      }
      return stream();
    });

    const plugins = new Map<string, InternalPlugin>([["echo", makePlugin("echo")]]);
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

    expect(provider.getCallCount()).toBe(2);
    expect(result).toBe("iter 2");
  });

  test("stream-valid parses valid JSON tool input stream into tool_use content", async () => {
    const { events, result } = await runStreamingStrategyOnce(
      chunkedToolUseStream("t1", "echo", ['{"text":"hi","count":2}'])
    );

    expect(result.content).toEqual([
      {
        input: { count: 2, text: "hi" },
        name: "echo",
        toolUseId: "t1",
        type: "tool_use",
      },
    ]);
    expect(result.stopReason).toBe("tool_use");
    expect(events.some((event) => event.type === "parse.error")).toBe(false);
  });

  test("parse-error emits explicit streamed tool parse error and keeps strategy recoverable", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeStreamProvider(() => chunkedToolUseStream("t1", "echo", ['{"text":"hi"']));

    const result = await Effect.runPromise(
      streamingStrategy(
        provider,
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        undefined,
        makeEmit(events)
      )
    );

    expect(result.content).toEqual([]);
    expect(result.stopReason).toBe("tool_use");
    expect(events).toEqual([
      {
        error: expect.stringContaining("JSON"),
        rawInput: '{"text":"hi"',
        timestamp: expect.any(Number),
        toolName: "echo",
        toolUseId: "t1",
        type: "parse.error",
      },
    ]);
  });

  test("parse-error keeps runStreamReactLoop recoverable on invalid tool JSON", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeStreamProvider(() => chunkedToolUseStream("t1", "echo", ['{"text":"hi"']));

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

    expect(result).toBe("");
    expect(events.map((event) => event.type)).toEqual([
      "turn.start",
      "stream.start",
      "parse.error",
      "stream.end",
      "turn.end",
      "agent.transition",
      "agent.complete",
      "session.end",
    ]);
    expect(events[2]).toEqual({
      error: expect.stringContaining("JSON"),
      rawInput: '{"text":"hi"',
      timestamp: expect.any(Number),
      toolName: "echo",
      toolUseId: "t1",
      type: "parse.error",
    });
    expect(events.some((event) => event.type === "agent.error")).toBe(false);
  });

  test("emits empty tool_use input as empty object", async () => {
    const { events, result } = await runStreamingStrategyOnce(
      chunkedToolUseStream("t1", "echo", [])
    );

    expect(result.content).toEqual([
      {
        input: {},
        name: "echo",
        toolUseId: "t1",
        type: "tool_use",
      },
    ]);
    expect(events.some((event) => event.type === "parse.error")).toBe(false);
  });

  test("parses tool input split across partial chunks", async () => {
    const { events, result } = await runStreamingStrategyOnce(
      chunkedToolUseStream("t1", "echo", ['{"text":"he', 'llo","nested":', '{"ok":true}}'])
    );

    expect(result.content).toEqual([
      {
        input: { nested: { ok: true }, text: "hello" },
        name: "echo",
        toolUseId: "t1",
        type: "tool_use",
      },
    ]);
    expect(events.some((event) => event.type === "parse.error")).toBe(false);
  });
});
