import { describe, expect, test } from "bun:test";
import { InMemoryCheckpointStore } from "@obsku/framework";
import { agent } from "../../src/agent/index";
import type { LLMProvider, LLMResponse, Message } from "../../src/types/index";

function createCapturingProvider() {
  let capturedMessages: Array<Message> = [];

  const provider: LLMProvider & { getCapturedMessages: () => Array<Message> } = {
    async chat(messages: Array<Message>): Promise<LLMResponse> {
      capturedMessages = messages;
      return {
        content: [{ text: "ok", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
    async *chatStream() {},
    contextWindowSize: 200_000,
    getCapturedMessages: () => capturedMessages,
  };

  return provider;
}

function textSequence(messages: Array<Message>): Array<string> {
  return messages.flatMap((message) =>
    message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
  );
}

describe("run-program startup", () => {
  test("run-program merges external messages before checkpoint history", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/test");
    await store.addMessage(session.id, {
      content: "Checkpoint question",
      role: "user",
      sessionId: session.id,
    });
    await store.addMessage(session.id, {
      content: "Checkpoint answer",
      role: "assistant",
      sessionId: session.id,
    });

    const provider = createCapturingProvider();
    const testAgent = agent({
      name: "checkpoint-agent",
      prompt: "You are a checkpoint agent.",
    });

    await testAgent.run("Current question", provider, {
      checkpointStore: store,
      messages: [
        { content: "External question", role: "user" },
        { content: "External answer", role: "assistant" },
      ],
      sessionId: session.id,
    });

    expect(textSequence(provider.getCapturedMessages())).toEqual([
      "You are a checkpoint agent.",
      "External question",
      "External answer",
      "Checkpoint question",
      "Checkpoint answer",
      "Current question",
    ]);
  });

  test("run-program loads startup history from legacy memory provider", async () => {
    const provider = createCapturingProvider();
    const history: Array<Message> = [
      { content: [{ text: "Memory question", type: "text" }], role: "user" },
      { content: [{ text: "Memory answer", type: "text" }], role: "assistant" },
    ];

    const testAgent = agent({
      memory: {
        load: async () => history,
        save: async () => undefined,
      },
      name: "memory-agent",
      prompt: "You are a memory agent.",
    });

    await testAgent.run("Current question", provider, { sessionId: "memory-session" });

    expect(textSequence(provider.getCapturedMessages())).toEqual([
      "You are a memory agent.",
      "Memory question",
      "Memory answer",
      "Current question",
    ]);
  });
});
