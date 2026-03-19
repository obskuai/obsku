import { describe, expect, test } from "bun:test";
import type { StoredMessage, StoredToolResult } from "../../src/checkpoint/types";

describe("StoredToolResult status", () => {
  test("can include status field with error value", () => {
    const toolResult: StoredToolResult = {
      content: "error message",
      status: "error",
      toolUseId: "tool-123",
    };

    expect(toolResult.toolUseId).toBe("tool-123");
    expect(toolResult.content).toBe("error message");
    expect(toolResult.status).toBe("error");
  });

  test("can include status field with success value", () => {
    const toolResult: StoredToolResult = {
      content: "success output",
      status: "success",
      toolUseId: "tool-123",
    };

    expect(toolResult.status).toBe("success");
  });

  test("status is optional - existing messages without it still work", () => {
    const toolResult: StoredToolResult = {
      content: "full output",
      toolUseId: "tool-123",
    };

    expect(toolResult.toolUseId).toBe("tool-123");
    expect(toolResult.content).toBe("full output");
    expect(toolResult.status).toBeUndefined();
  });

  test("JSON serialization/deserialization preserves status", () => {
    const toolResult: StoredToolResult = {
      content: "error occurred",
      status: "error",
      toolUseId: "tool-123",
    };

    const serialized = JSON.stringify(toolResult);
    const deserialized: StoredToolResult = JSON.parse(serialized);

    expect(deserialized.toolUseId).toBe("tool-123");
    expect(deserialized.content).toBe("error occurred");
    expect(deserialized.status).toBe("error");
  });

  test("StoredMessage with toolResults containing status persists correctly", () => {
    const message: StoredMessage = {
      createdAt: Date.now(),
      id: 1,
      role: "tool",
      sessionId: "session-abc",
      toolResults: [
        {
          content: "error...",
          status: "error",
          toolUseId: "tool-1",
        },
        {
          content: "success",
          status: "success",
          toolUseId: "tool-2",
        },
        {
          content: "no status",
          toolUseId: "tool-3",
        },
      ],
    };

    expect(message.toolResults).toHaveLength(3);
    expect(message.toolResults![0].status).toBe("error");
    expect(message.toolResults![1].status).toBe("success");
    expect(message.toolResults![2].status).toBeUndefined();
  });

  test("JSON serialization of StoredMessage preserves status in toolResults", () => {
    const message: StoredMessage = {
      createdAt: 1_234_567_890,
      id: 1,
      role: "tool",
      sessionId: "session-abc",
      toolResults: [
        {
          content: "error...",
          status: "error",
          toolUseId: "tool-1",
        },
      ],
    };

    const serialized = JSON.stringify(message);
    const deserialized: StoredMessage = JSON.parse(serialized);

    expect(deserialized.toolResults).toHaveLength(1);
    expect(deserialized.toolResults![0].toolUseId).toBe("tool-1");
    expect(deserialized.toolResults![0].content).toBe("error...");
    expect(deserialized.toolResults![0].status).toBe("error");
  });
});

describe("StoredToolResult fullOutputRef", () => {
  test("can include fullOutputRef field", () => {
    const toolResult: StoredToolResult = {
      content: "truncated output...",
      fullOutputRef: "blob-ref-456",
      toolUseId: "tool-123",
    };

    expect(toolResult.toolUseId).toBe("tool-123");
    expect(toolResult.content).toBe("truncated output...");
    expect(toolResult.fullOutputRef).toBe("blob-ref-456");
  });

  test("fullOutputRef is optional - existing messages without it still work", () => {
    const toolResult: StoredToolResult = {
      content: "full output",
      toolUseId: "tool-123",
    };

    expect(toolResult.toolUseId).toBe("tool-123");
    expect(toolResult.content).toBe("full output");
    expect(toolResult.fullOutputRef).toBeUndefined();
  });

  test("JSON serialization/deserialization preserves fullOutputRef", () => {
    const toolResult: StoredToolResult = {
      content: "truncated output...",
      fullOutputRef: "blob-ref-456",
      toolUseId: "tool-123",
    };

    const serialized = JSON.stringify(toolResult);
    const deserialized: StoredToolResult = JSON.parse(serialized);

    expect(deserialized.toolUseId).toBe("tool-123");
    expect(deserialized.content).toBe("truncated output...");
    expect(deserialized.fullOutputRef).toBe("blob-ref-456");
  });

  test("StoredMessage with toolResults containing fullOutputRef persists correctly", () => {
    const message: StoredMessage = {
      createdAt: Date.now(),
      id: 1,
      role: "tool",
      sessionId: "session-abc",
      toolResults: [
        {
          content: "truncated...",
          fullOutputRef: "ref-001",
          toolUseId: "tool-1",
        },
        {
          content: "not truncated",
          toolUseId: "tool-2",
        },
      ],
    };

    expect(message.toolResults).toHaveLength(2);
    expect(message.toolResults![0].fullOutputRef).toBe("ref-001");
    expect(message.toolResults![1].fullOutputRef).toBeUndefined();
  });

  test("JSON serialization of StoredMessage preserves fullOutputRef in toolResults", () => {
    const message: StoredMessage = {
      createdAt: 1_234_567_890,
      id: 1,
      role: "tool",
      sessionId: "session-abc",
      toolResults: [
        {
          content: "truncated...",
          fullOutputRef: "ref-001",
          toolUseId: "tool-1",
        },
      ],
    };

    const serialized = JSON.stringify(message);
    const deserialized: StoredMessage = JSON.parse(serialized);

    expect(deserialized.toolResults).toHaveLength(1);
    expect(deserialized.toolResults![0].toolUseId).toBe("tool-1");
    expect(deserialized.toolResults![0].content).toBe("truncated...");
    expect(deserialized.toolResults![0].fullOutputRef).toBe("ref-001");
  });
});
