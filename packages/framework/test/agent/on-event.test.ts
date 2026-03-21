import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { agent } from "../../src/agent";
import type { DefaultPublicPayload } from "../../src/output-policy";
import { plugin } from "../../src/plugin";
import type { AgentEvent, LLMProvider, PluginDef } from "../../src/types";

async function nextMatching(
  iterator: AsyncIterator<DefaultPublicPayload<AgentEvent>>,
  predicate: (event: DefaultPublicPayload<AgentEvent>) => boolean
): Promise<DefaultPublicPayload<AgentEvent>> {
  while (true) {
    const next = await iterator.next();
    if (next.done) {
      throw new Error("subscription ended early");
    }
    if (predicate(next.value)) {
      return next.value;
    }
  }
}

describe("agent.run onEvent", () => {
  test("forwards StreamChunk, ToolCalling, ToolResult", async () => {
    const events: Array<DefaultPublicPayload<AgentEvent>> = [];

    const echo: PluginDef<z.ZodObject<{ text: z.ZodString }>> = {
      description: "Echo",
      name: "echo",
      params: z.object({ text: z.string() }),
      run: async (input) => input.text,
    };

    let callCount = 0;
    const provider: LLMProvider = {
      chat: async () => ({
        content: [{ text: "unused", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
      chatStream: async function* () {
        callCount++;
        if (callCount === 1) {
          yield { name: "echo", toolUseId: "t1", type: "tool_use_start" };
          yield { input: '{"text":"hi"}', type: "tool_use_delta" };
          yield { type: "tool_use_end" };
          yield {
            stopReason: "tool_use",
            type: "message_end",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
          return;
        }
        yield { content: "hello ", type: "text_delta" };
        yield { content: "world", type: "text_delta" };
        yield {
          stopReason: "end_turn",
          type: "message_end",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "event-agent",
      prompt: "Use tool",
      streaming: true,
      tools: [plugin(echo)],
    });
    const result = await a.run("hi", provider, {
      onEvent: (event) => events.push(event as unknown as DefaultPublicPayload<AgentEvent>),
    });

    expect(result).toBe("hello world");
    expect(events.some((event) => event.type === "stream.chunk")).toBe(true);
    expect(events.some((event) => event.type === "tool.call")).toBe(true);
    expect(events.some((event) => event.type === "tool.result")).toBe(true);
  });

  test("subscribe exposes session-scoped events across multiple runs", async () => {
    const outputs = ["first", "second"];
    let index = 0;
    const provider: LLMProvider = {
      chat: async () => ({
        content: [],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
      chatStream: async function* () {
        yield { content: outputs[index++] ?? "done", type: "text_delta" };
        yield {
          stopReason: "end_turn",
          type: "message_end",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({ name: "session-agent", prompt: "Reply", streaming: true });
    const sessionId = "session-subscribe-test";
    const subscription = await a.subscribe({ sessionId });
    const iterator = subscription[Symbol.asyncIterator]() as AsyncIterator<
      DefaultPublicPayload<AgentEvent>
    >;

    const firstRun = a.run("one", provider, { sessionId });
    const firstChunk = await nextMatching(
      iterator,
      (event) =>
        event.type === "stream.chunk" &&
        (event as DefaultPublicPayload<Extract<AgentEvent, { type: "stream.chunk" }>>).data
          .content === "first"
    );
    const secondRun = a.run("two", provider, { sessionId });
    const secondChunk = await nextMatching(
      iterator,
      (event) =>
        event.type === "stream.chunk" &&
        (event as DefaultPublicPayload<Extract<AgentEvent, { type: "stream.chunk" }>>).data
          .content === "second"
    );

    expect((await firstRun).trim()).toBe("first");
    expect((await secondRun).trim()).toBe("second");
    expect(firstChunk.type).toBe("stream.chunk");
    expect(secondChunk.type).toBe("stream.chunk");

    await iterator.return?.();
  });
});
