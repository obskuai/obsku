import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentEvent, LLMProvider, LLMStreamEvent, Message, ToolDef } from "../../src/types";
import { defaultConfig, makeEmit } from "../utils/helpers";
import { runStreamReactLoop } from "../utils/loop-helpers";
import { textResponse } from "../utils/responses";

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
      callCount += 1;
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

describe("stream parse characterization", () => {
  test("stream parse error characterization emits parse.error and no tool events for invalid streamed JSON", async () => {
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
    expect(events.some((event) => event.type === "tool.call" || event.type === "tool.result")).toBe(
      false
    );
  });

  test("stream parse error characterization emits explicit object-shape error for non-object streamed JSON", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeStreamProvider(() => chunkedToolUseStream("t2", "echo", ['["bad"]']));

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
      error: "Expected streamed tool input JSON object",
      rawInput: '["bad"]',
      timestamp: expect.any(Number),
      toolName: "echo",
      toolUseId: "t2",
      type: "parse.error",
    });
    expect(events.some((event) => event.type === "tool.call" || event.type === "tool.result")).toBe(
      false
    );
  });
});
