import { describe, expect, it } from "bun:test";
import { estimateMessageTokens, estimateTokens } from "../../src/agent/token-estimation";
import type { Message, TextContent, ToolResultContent, ToolUseContent } from "../../src/types/llm";

describe("estimateTokens", () => {
  it("should return 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should estimate tokens correctly for simple text", () => {
    // "hello world" = 11 chars, 11/4 = 2.75 → rounded to 3
    expect(estimateTokens("hello world")).toBe(3);
  });

  it("should estimate tokens correctly for short text", () => {
    // "hi" = 2 chars, 2/4 = 0.5 → rounded to 1
    expect(estimateTokens("hi")).toBe(1);
  });

  it("should estimate tokens correctly for longer text", () => {
    // "This is a longer message with more content" = 42 chars, 42/4 = 10.5 → rounded to 11
    expect(estimateTokens("This is a longer message with more content")).toBe(11);
  });

  it("should handle single character", () => {
    // "a" = 1 char, 1/4 = 0.25 → rounded to 0
    expect(estimateTokens("a")).toBe(0);
  });

  it("should handle four characters", () => {
    // "test" = 4 chars, 4/4 = 1 → rounded to 1
    expect(estimateTokens("test")).toBe(1);
  });
});

describe("estimateMessageTokens", () => {
  it("should return 0 for empty message array", () => {
    expect(estimateMessageTokens([])).toBe(0);
  });

  it("should estimate tokens for message with TextContent", () => {
    const textContent: TextContent = { text: "hello world", type: "text" };
    const message: Message = { content: [textContent], role: "user" };
    // 11 chars / 4 = 2.75 → 3 tokens
    expect(estimateMessageTokens([message])).toBe(3);
  });

  it("should estimate tokens for message with ToolUseContent", () => {
    const toolUseContent: ToolUseContent = {
      input: { text: "hello" },
      name: "echo",
      toolUseId: "tool-123",
      type: "tool_use",
    };
    const message: Message = { content: [toolUseContent], role: "assistant" };
    // JSON.stringify({ text: "hello" }) = '{"text":"hello"}' = 17 chars, 17/4 = 4.25 → 4 tokens
    expect(estimateMessageTokens([message])).toBe(4);
  });

  it("should estimate tokens for message with ToolResultContent", () => {
    const toolResultContent: ToolResultContent = {
      content: "Tool execution result here",
      toolUseId: "tool-123",
      type: "tool_result",
    };
    const message: Message = { content: [toolResultContent], role: "user" };
    // 26 chars / 4 = 6.5 → 7 tokens
    expect(estimateMessageTokens([message])).toBe(7);
  });

  it("should estimate tokens for multiple messages", () => {
    const textContent: TextContent = { text: "hello", type: "text" };
    const message1: Message = { content: [textContent], role: "user" };

    const textContent2: TextContent = { text: "world", type: "text" };
    const message2: Message = { content: [textContent2], role: "assistant" };

    // "hello" = 5 chars / 4 = 1.25 → 1 token
    // "world" = 5 chars / 4 = 1.25 → 1 token
    // Total = 2 tokens
    expect(estimateMessageTokens([message1, message2])).toBe(2);
  });

  it("should estimate tokens for mixed content types", () => {
    const textContent: TextContent = { text: "Use this tool", type: "text" };
    const toolUseContent: ToolUseContent = {
      input: { text: "hello world" },
      name: "echo",
      toolUseId: "tool-123",
      type: "tool_use",
    };
    const toolResultContent: ToolResultContent = {
      content: "Result: hello world",
      toolUseId: "tool-123",
      type: "tool_result",
    };

    const message: Message = {
      content: [textContent, toolUseContent, toolResultContent],
      role: "assistant",
    };

    // "Use this tool" = 13 chars / 4 = 3.25 → 3 tokens
    // JSON.stringify({ text: "hello world" }) = '{"text":"hello world"}' = 24 chars / 4 = 6 tokens
    // "Result: hello world" = 19 chars / 4 = 4.75 → 5 tokens
    // Total = 14 tokens
    expect(estimateMessageTokens([message])).toBe(14);
  });

  it("should estimate tokens for multiple content blocks across messages", () => {
    const textContent1: TextContent = { text: "First message", type: "text" };
    const message1: Message = { content: [textContent1], role: "user" };

    const textContent2: TextContent = { text: "Second message", type: "text" };
    const toolUseContent: ToolUseContent = {
      input: { target: "example.com" },
      name: "scan",
      toolUseId: "tool-456",
      type: "tool_use",
    };
    const message2: Message = { content: [textContent2, toolUseContent], role: "assistant" };

    // "First message" = 13 chars / 4 = 3.25 → 3 tokens
    // "Second message" = 14 chars / 4 = 3.5 → 4 tokens
    // JSON.stringify({ target: "example.com" }) = '{"target":"example.com"}' = 25 chars / 4 = 6.25 → 6 tokens
    // Total = 13 tokens
    expect(estimateMessageTokens([message1, message2])).toBe(13);
  });

  it("should handle messages with empty content array", () => {
    const message: Message = { content: [], role: "user" };
    expect(estimateMessageTokens([message])).toBe(0);
  });

  it("should handle message with empty text content", () => {
    const textContent: TextContent = { text: "", type: "text" };
    const message: Message = { content: [textContent], role: "user" };
    expect(estimateMessageTokens([message])).toBe(0);
  });

  it("should handle tool result with empty content", () => {
    const toolResultContent: ToolResultContent = {
      content: "",
      toolUseId: "tool-123",
      type: "tool_result",
    };
    const message: Message = { content: [toolResultContent], role: "user" };
    expect(estimateMessageTokens([message])).toBe(0);
  });

  it("should handle tool use with empty input object", () => {
    const toolUseContent: ToolUseContent = {
      input: {},
      name: "echo",
      toolUseId: "tool-123",
      type: "tool_use",
    };
    const message: Message = { content: [toolUseContent], role: "assistant" };
    // JSON.stringify({}) = "{}" = 2 chars / 4 = 0.5 → 1 token (rounded)
    expect(estimateMessageTokens([message])).toBe(1);
  });
});
