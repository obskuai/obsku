import { describe, expect, it } from "bun:test";
import { InMemoryProvider } from "../../src/memory/in-memory";
import type { Message } from "../../src/types";

describe("InMemoryProvider", () => {
  it("should return empty array for non-existent session", async () => {
    const provider = new InMemoryProvider();
    const messages = await provider.load("non-existent-session");
    expect(messages).toEqual([]);
  });

  it("should save and load messages for a session", async () => {
    const provider = new InMemoryProvider();
    const sessionId = "test-session";
    const messages: Array<Message> = [
      { content: [{ text: "Hello", type: "text" }], role: "user" },
      { content: [{ text: "Hi there", type: "text" }], role: "assistant" },
    ];

    await provider.save(sessionId, messages);
    const loaded = await provider.load(sessionId);

    expect(loaded).toEqual(messages);
  });

  it("should isolate sessions from each other", async () => {
    const provider = new InMemoryProvider();

    const session1Messages: Array<Message> = [
      { content: [{ text: "Session 1", type: "text" }], role: "user" },
    ];
    const session2Messages: Array<Message> = [
      { content: [{ text: "Session 2", type: "text" }], role: "user" },
    ];

    await provider.save("session-1", session1Messages);
    await provider.save("session-2", session2Messages);

    const loaded1 = await provider.load("session-1");
    const loaded2 = await provider.load("session-2");

    expect(loaded1).toEqual(session1Messages);
    expect(loaded2).toEqual(session2Messages);
    expect(loaded1).not.toEqual(loaded2);
  });

  it("should overwrite existing session data", async () => {
    const provider = new InMemoryProvider();
    const sessionId = "test-session";

    const initialMessages: Array<Message> = [
      { content: [{ text: "Initial", type: "text" }], role: "user" },
    ];
    const updatedMessages: Array<Message> = [
      { content: [{ text: "Updated", type: "text" }], role: "user" },
      { content: [{ text: "Response", type: "text" }], role: "assistant" },
    ];

    await provider.save(sessionId, initialMessages);
    await provider.save(sessionId, updatedMessages);

    const loaded = await provider.load(sessionId);
    expect(loaded).toEqual(updatedMessages);
  });
});
