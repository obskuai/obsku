import { describe, expect, it } from "bun:test";
import { agent } from "../../src/agent/index";
import type { LLMProvider, Message, ToolDef } from "../../src/types/index";

const mockProvider: LLMProvider = {
  async chat(messages: Array<Message>, _tools?: Array<ToolDef>) {
    (mockProvider as any).lastMessages = messages;
    return {
      content: [{ text: "Mock response", type: "text" as const }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  },
  async chatStream() {
    throw new Error("Not implemented");
  },
  contextWindowSize: 100_000,
};

describe("Conversation history support", () => {
  it("passes messages as conversation history", async () => {
    const testAgent = agent({
      name: "test",
      prompt: "You are a test agent.",
    });

    await testAgent.run("Current question", mockProvider, {
      messages: [
        { content: "Previous question", role: "user" },
        { content: "Previous answer", role: "assistant" },
      ],
    });

    const lastMessages = (mockProvider as any).lastMessages;
    expect(lastMessages.length).toBeGreaterThanOrEqual(3);

    const hasUserHistory = lastMessages.some(
      (m: Message) =>
        m.role === "user" &&
        m.content.some((c) => c.type === "text" && c.text.includes("Previous question"))
    );
    const hasAssistantHistory = lastMessages.some(
      (m: Message) =>
        m.role === "assistant" &&
        m.content.some((c) => c.type === "text" && c.text.includes("Previous answer"))
    );

    expect(hasUserHistory).toBe(true);
    expect(hasAssistantHistory).toBe(true);
  });

  it("works without messages (backward compatible)", async () => {
    const testAgent = agent({
      name: "test",
      prompt: "You are a test agent.",
    });

    await testAgent.run("Hello", mockProvider);

    const lastMessages = (mockProvider as any).lastMessages;
    expect(lastMessages.length).toBeGreaterThanOrEqual(1);
  });

  it("handles empty messages array", async () => {
    const testAgent = agent({
      name: "test",
      prompt: "You are a test agent.",
    });

    await testAgent.run("Hello", mockProvider, { messages: [] });

    const lastMessages = (mockProvider as any).lastMessages;
    expect(lastMessages.length).toBeGreaterThanOrEqual(1);
  });
});
