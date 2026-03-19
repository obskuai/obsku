import { describe, expect, it } from "bun:test";
import { parseAgentCoreRequest } from "../src/parse-request";

describe("parseAgentCoreRequest", () => {
  it('parses { message: "hello" } → input: "hello"', () => {
    const result = parseAgentCoreRequest({ message: "hello" });
    expect(result.input).toBe("hello");
    expect(result.messages).toBeUndefined();
  });

  it(String.raw`parses { prompt: [{ text: "hello" }, { text: "world" }] } → input: "hello\nworld"`, () => {
    const result = parseAgentCoreRequest({ prompt: [{ text: "hello" }, { text: "world" }] });
    expect(result.input).toBe("hello\nworld");
    expect(result.messages).toBeUndefined();
  });

  it("message takes priority over messages[]", () => {
    const result = parseAgentCoreRequest({
      message: "new",
      messages: [
        { content: "prev", role: "user" },
        { content: "resp", role: "assistant" },
      ],
    });
    expect(result.input).toBe("new");
    expect(result.messages).toEqual([
      { content: "prev", role: "user" },
      { content: "resp", role: "assistant" },
    ]);
  });

  it("parses messages[] with user→assistant → finds last user as input", () => {
    const result = parseAgentCoreRequest({
      messages: [
        { content: "a", role: "user" },
        { content: "b", role: "assistant" },
      ],
    });
    expect(result.input).toBe("a");
    expect(result.messages).toEqual([]);
  });

  it("parses messages[] with conversation history", () => {
    const result = parseAgentCoreRequest({
      messages: [
        { content: "first", role: "user" },
        { content: "response1", role: "assistant" },
        { content: "second", role: "user" },
      ],
    });
    expect(result.input).toBe("second");
    expect(result.messages).toEqual([
      { content: "first", role: "user" },
      { content: "response1", role: "assistant" },
    ]);
  });

  it('parses model as string → model: "claude-3"', () => {
    const result = parseAgentCoreRequest({
      message: "hello",
      model: "claude-3",
    });
    expect(result.model).toBe("claude-3");
  });

  it('parses model as object with modelId → model: "claude-3"', () => {
    const result = parseAgentCoreRequest({
      message: "hello",
      model: { modelId: "claude-3", region: "us-east-1" },
    });
    expect(result.model).toBe("claude-3");
  });

  it("parses session_id → sessionId", () => {
    const result = parseAgentCoreRequest({
      message: "hello",
      session_id: "sess-123",
    });
    expect(result.sessionId).toBe("sess-123");
  });

  it("throws error for empty object", () => {
    expect(() => parseAgentCoreRequest({})).toThrow("No input found in request");
  });

  it("throws error for null", () => {
    expect(() => parseAgentCoreRequest(null)).toThrow("Request body must be an object");
  });

  it("throws error for undefined", () => {
    expect(() => parseAgentCoreRequest(undefined)).toThrow("Request body must be an object");
  });

  it("throws error for string input", () => {
    expect(() => parseAgentCoreRequest("not an object")).toThrow("Request body must be an object");
  });

  it("parses messages with array content", () => {
    const result = parseAgentCoreRequest({
      messages: [{ content: [{ text: "part1" }, { text: "part2" }], role: "user" }],
    });
    expect(result.input).toBe("part1\npart2");
  });

  it("parses prompt[] + messages[] combo → input from prompt, messages preserved", () => {
    const result = parseAgentCoreRequest({
      messages: [
        { content: "first", role: "user" },
        { content: "response1", role: "assistant" },
        { content: "second", role: "user" },
      ],
      prompt: [{ text: "current input" }],
    });
    expect(result.input).toBe("current input");
    expect(result.messages).toEqual([
      { content: "first", role: "user" },
      { content: "response1", role: "assistant" },
      { content: "second", role: "user" },
    ]);
  });

  it("parses message + messages[] combo → input from message, messages preserved", () => {
    const result = parseAgentCoreRequest({
      message: "current input",
      messages: [
        { content: "first", role: "user" },
        { content: "response1", role: "assistant" },
      ],
    });
    expect(result.input).toBe("current input");
    expect(result.messages).toEqual([
      { content: "first", role: "user" },
      { content: "response1", role: "assistant" },
    ]);
  });

  it("falls back to last message content when history has no user role", () => {
    const result = parseAgentCoreRequest({
      messages: [
        { content: "assistant-only context", role: "assistant" },
        { content: [{ text: "latest" }, { text: "reply" }], role: "assistant" },
      ],
    });

    expect(result.input).toBe("latest\nreply");
    expect(result.messages).toEqual([{ content: "assistant-only context", role: "assistant" }]);
  });

  it("parses prompt[] + messages[] combo with array content", () => {
    const result = parseAgentCoreRequest({
      messages: [
        { content: [{ text: "part1" }, { text: "part2" }], role: "user" },
        { content: "response", role: "assistant" },
      ],
      prompt: [{ text: "current" }],
    });
    expect(result.input).toBe("current");
    expect(result.messages).toEqual([
      { content: "part1\npart2", role: "user" },
      { content: "response", role: "assistant" },
    ]);
  });
});
