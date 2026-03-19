import { describe, expect, it } from "bun:test";
import { agent } from "../../src/agent";
import { InMemoryProvider } from "../../src/memory/in-memory";
import type { Message } from "../../src/types";
import { mockLLMProvider } from "../utils/mock-llm-provider";

describe("Agent with Memory", () => {
  it("should work without memory (backward compatibility)", async () => {
    const testAgent = agent({
      name: "test-agent",
      prompt: "You are a test agent",
    });

    const provider = mockLLMProvider();
    const result = await testAgent.run("Hello", provider);

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should work without sessionId even with memory configured", async () => {
    const memory = new InMemoryProvider();
    const testAgent = agent({
      memory,
      name: "test-agent",
      prompt: "You are a test agent",
    });

    const provider = mockLLMProvider();
    const result = await testAgent.run("Hello", provider);

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should save messages to memory after run with sessionId", async () => {
    const memory = new InMemoryProvider();
    const testAgent = agent({
      memory,
      name: "test-agent",
      prompt: "You are a test agent",
    });

    const provider = mockLLMProvider();
    const sessionId = "test-session-1";

    await testAgent.run("Hello", provider, { sessionId });

    const savedMessages = await memory.load(sessionId);
    expect(savedMessages.length).toBeGreaterThan(0);
  });

  it("should load previous messages on subsequent runs with same sessionId", async () => {
    const memory = new InMemoryProvider();
    const testAgent = agent({
      memory,
      name: "test-agent",
      prompt: "You are a test agent",
    });

    const provider = mockLLMProvider();
    const sessionId = "test-session-2";

    await testAgent.run("First message", provider, { sessionId });
    const messagesAfterFirst = await memory.load(sessionId);

    await testAgent.run("Second message", provider, { sessionId });
    const messagesAfterSecond = await memory.load(sessionId);

    expect(messagesAfterSecond.length).toBeGreaterThanOrEqual(messagesAfterFirst.length);
  });

  it("should isolate different sessionIds", async () => {
    const memory = new InMemoryProvider();
    const testAgent = agent({
      memory,
      name: "test-agent",
      prompt: "You are a test agent",
    });

    const provider = mockLLMProvider();

    await testAgent.run("Message for session A", provider, { sessionId: "session-a" });
    await testAgent.run("Message for session B", provider, { sessionId: "session-b" });

    const messagesA = await memory.load("session-a");
    const messagesB = await memory.load("session-b");

    expect(messagesA.length).toBeGreaterThan(0);
    expect(messagesB.length).toBeGreaterThan(0);
  });

  it("should include history in messages when loading", async () => {
    const memory = new InMemoryProvider();
    const sessionId = "test-history-session";

    const initialMessages: Array<Message> = [
      { content: [{ text: "Previous question", type: "text" }], role: "user" },
      { content: [{ text: "Previous answer", type: "text" }], role: "assistant" },
    ];
    await memory.save(sessionId, initialMessages);

    const testAgent = agent({
      memory,
      name: "test-agent",
      prompt: "You are a test agent",
    });

    const provider = mockLLMProvider();
    await testAgent.run("New question", provider, { sessionId });

    const savedMessages = await memory.load(sessionId);
    expect(savedMessages.length).toBeGreaterThan(initialMessages.length);
  });

  it("should handle empty memory gracefully", async () => {
    const memory = new InMemoryProvider();
    const testAgent = agent({
      memory,
      name: "test-agent",
      prompt: "You are a test agent",
    });

    const provider = mockLLMProvider();
    const sessionId = "empty-session";

    const result = await testAgent.run("Hello", provider, { sessionId });

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);

    const savedMessages = await memory.load(sessionId);
    expect(savedMessages.length).toBeGreaterThan(0);
  });
});
