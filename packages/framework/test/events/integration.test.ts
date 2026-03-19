import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { agent } from "../../src/agent";
import { plugin } from "../../src/plugin";
import type { AgentEvent, AgentEventType, LLMProvider } from "../../src/types";

async function collectUntilSessionEnd(
  iterator: AsyncIterator<AgentEvent>
): Promise<Array<AgentEvent>> {
  const events: Array<AgentEvent> = [];

  while (true) {
    const next = await iterator.next();
    if (next.done) {
      throw new Error("subscription ended before session.end");
    }

    events.push(next.value);
    if (next.value.type === "session.end") {
      return events;
    }
  }
}

function indexOfType(events: Array<AgentEvent>, type: AgentEventType): number {
  return events.findIndex((event) => event.type === type);
}

function getStreamLifecycleIndices(events: Array<AgentEvent>) {
  let start = -1;
  let chunk = -1;

  for (let index = 0; index < events.length; index++) {
    const event = events[index];

    if (event.type === "stream.start") {
      start = index;
      chunk = -1;
      continue;
    }

    if (event.type === "stream.chunk" && start !== -1 && chunk === -1) {
      chunk = index;
      continue;
    }

    if (event.type === "stream.end" && start !== -1 && chunk !== -1) {
      return { chunk, end: index, start };
    }
  }

  throw new Error("missing ordered stream.start -> stream.chunk -> stream.end lifecycle");
}

function assertOrderingInvariants(events: Array<AgentEvent>) {
  let sessionStarted = false;
  let openTurns = 0;
  let openStream = false;
  const calledToolIds = new Set<string>();

  for (const event of events) {
    switch (event.type) {
      case "session.start":
        sessionStarted = true;
        break;
      case "turn.start":
        expect(sessionStarted).toBe(true);
        openTurns += 1;
        break;
      case "turn.end":
        expect(openTurns).toBeGreaterThan(0);
        openTurns -= 1;
        break;
      case "stream.start":
        expect(openTurns).toBeGreaterThan(0);
        expect(openStream).toBe(false);
        openStream = true;
        break;
      case "stream.chunk":
        expect(openStream).toBe(true);
        break;
      case "stream.end":
        expect(openStream).toBe(true);
        openStream = false;
        break;
      case "tool.call":
        calledToolIds.add(event.toolUseId);
        break;
      case "tool.result":
        expect(calledToolIds.has(event.toolUseId)).toBe(true);
        break;
      case "session.end":
        expect(sessionStarted).toBe(true);
        expect(openTurns).toBe(0);
        expect(openStream).toBe(false);
        break;
    }
  }
}

describe("event stream integration", () => {
  test("captures full lifecycle via subscribe API", async () => {
    const expectedDotCaseTypes = new Set<AgentEventType>([
      "session.start",
      "agent.transition",
      "turn.start",
      "stream.start",
      "stream.chunk",
      "stream.end",
      "turn.end",
      "tool.call",
      "tool.progress",
      "tool.result",
      "agent.thinking",
      "agent.complete",
      "session.end",
    ]);

    const streamingTool = plugin({
      description: "Streams progress before final result",
      name: "stream_tool",
      params: z.object({ text: z.string() }),
      run: async function* (input: { text: string }) {
        yield { message: "starting", percent: 50, status: "running" };
        yield `tool:${input.text}`;
      },
    });

    let callCount = 0;
    const provider: LLMProvider = {
      chat: async () => ({
        content: [{ text: "unused", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
      chatStream: async function* () {
        callCount += 1;

        if (callCount === 1) {
          yield { content: "prep ", type: "text_delta" };
          yield { name: "stream_tool", toolUseId: "tool-1", type: "tool_use_start" };
          yield { input: '{"text":"hi"}', type: "tool_use_delta" };
          yield { type: "tool_use_end" };
          yield {
            stopReason: "tool_use",
            type: "message_end",
            usage: { inputTokens: 10, outputTokens: 5 },
          };
          return;
        }

        yield { content: "done", type: "text_delta" };
        yield {
          stopReason: "end_turn",
          type: "message_end",
          usage: { inputTokens: 12, outputTokens: 6 },
        };
      },
      contextWindowSize: 200_000,
    };

    const subject = agent({
      name: "integration-events",
      prompt: "Use the tool once, then finish.",
      streaming: true,
      tools: [streamingTool],
    });

    const sessionId = "integration-event-stream";
    const subscription = await subject.subscribe({ eventBusCapacity: 128, sessionId });
    const iterator = subscription[Symbol.asyncIterator]();

    const [result, events] = await Promise.all([
      subject.run("hi", provider, { eventBusCapacity: 128, sessionId }),
      collectUntilSessionEnd(iterator),
    ]);

    await iterator.return?.();

    expect(result).toBe("done");
    expect(callCount).toBe(2);

    const eventTypes = events.map((event) => event.type);
    expect(new Set(eventTypes)).toEqual(expectedDotCaseTypes);
    expect(eventTypes.every((type) => /^[a-z]+(?:\.[a-z]+)+$/.test(type))).toBe(true);

    expect(events[0]?.type).toBe("session.start");
    expect(events.at(-1)?.type).toBe("session.end");

    const sessionStartIndex = indexOfType(events, "session.start");
    const sessionEndIndex = indexOfType(events, "session.end");
    const turnStartIndex = indexOfType(events, "turn.start");
    const turnEndIndex = indexOfType(events, "turn.end");
    const toolCallIndex = indexOfType(events, "tool.call");
    const toolResultIndex = indexOfType(events, "tool.result");
    const streamIndices = getStreamLifecycleIndices(events);

    expect(sessionStartIndex).toBeGreaterThanOrEqual(0);
    expect(sessionEndIndex).toBeGreaterThan(sessionStartIndex);
    expect(turnStartIndex).toBeGreaterThan(sessionStartIndex);
    expect(turnEndIndex).toBeGreaterThan(turnStartIndex);
    expect(toolCallIndex).toBeGreaterThan(turnStartIndex);
    expect(toolResultIndex).toBeGreaterThan(toolCallIndex);
    expect(streamIndices.start).toBeGreaterThanOrEqual(turnStartIndex);
    expect(streamIndices.start).toBeLessThan(streamIndices.chunk);
    expect(streamIndices.chunk).toBeLessThan(streamIndices.end);

    assertOrderingInvariants(events);
  });
});
