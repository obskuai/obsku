import { describe, expect, it } from "bun:test";
import { parseStoredMessage } from "../../src/checkpoint/normalize-message";

describe("parseStoredMessage", () => {
  it("preserves valid stored message tool call payloads", () => {
    const storedMessage = {
      content: "Using tool",
      createdAt: 1_704_067_200_000,
      id: 1,
      role: "assistant" as const,
      sessionId: "session-1",
      toolCalls: [
        {
          function: {
            arguments: '{"city":"nyc","units":"metric"}',
            name: "weather",
          },
          id: "tool-1",
          type: "function",
        },
      ],
      toolResults: [{ content: "done", status: "success", toolUseId: "tool-1" }],
    } satisfies Record<string, unknown>;

    const parsed = parseStoredMessage(storedMessage);

    expect(parsed).toEqual({
      content: "Using tool",
      createdAt: 1_704_067_200_000,
      id: 1,
      role: "assistant",
      sessionId: "session-1",
      toolCalls: [
        { input: { city: "nyc", units: "metric" }, name: "weather", toolUseId: "tool-1" },
      ],
      toolResults: [{ content: "done", status: "success", toolUseId: "tool-1" }],
    });
  });

  it("normalize-message-invalid skips malformed stored tool-call JSON and warns", () => {
    const rawMessage = {
      createdAt: 1_704_067_200_000,
      id: 1,
      role: "assistant",
      sessionId: "session-1",
      toolCalls: [
        {
          function: {
            arguments: "{not valid json",
            name: "weather",
          },
          id: "tool-1",
          type: "function",
        },
      ],
    };

    const stderrChunks: Array<string> = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.env.OBSKU_DEBUG = "1";
    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    try {
      expect(parseStoredMessage(rawMessage)).toEqual({
        createdAt: 1_704_067_200_000,
        id: 1,
        role: "assistant",
        sessionId: "session-1",
      });
      const combined = stderrChunks.join("");
      expect(combined).toContain("Skipping stored tool call with invalid JSON arguments");
      expect(combined).toContain("tool-1");
    } finally {
      process.stderr.write = originalWrite;
      delete process.env.OBSKU_DEBUG;
    }
  });

  it("normalize-message-invalid skips stored tool-call args with invalid schema and warns", () => {
    const rawMessage = {
      createdAt: 1_704_067_200_000,
      id: 1,
      role: "assistant",
      sessionId: "session-1",
      toolCalls: [
        {
          function: {
            arguments: '["nyc","metric"]',
            name: "weather",
          },
          id: "tool-1",
          type: "function",
        },
      ],
    };

    const stderrChunks: Array<string> = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.env.OBSKU_DEBUG = "1";
    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    try {
      expect(parseStoredMessage(rawMessage)).toEqual({
        createdAt: 1_704_067_200_000,
        id: 1,
        role: "assistant",
        sessionId: "session-1",
      });
      const combined = stderrChunks.join("");
      expect(combined).toContain("Skipping stored tool call with invalid argument schema");
      expect(combined).toContain("tool-1");
    } finally {
      process.stderr.write = originalWrite;
      delete process.env.OBSKU_DEBUG;
    }
  });

  it("returns null for malformed stored tool-call payloads", () => {
    const rawMessage = {
      createdAt: 1_704_067_200_000,
      id: 1,
      role: "assistant",
      sessionId: "session-1",
      toolCalls: [{ function: { name: "weather" }, id: "tool-1", type: "function" }],
    };

    expect(parseStoredMessage(rawMessage)).toBeNull();
  });

  it("returns null for malformed stored tool results", () => {
    const rawMessage = {
      createdAt: 1_704_067_200_000,
      id: 1,
      role: "assistant",
      sessionId: "session-1",
      toolResults: [{ content: "done" }],
    };

    expect(parseStoredMessage(rawMessage)).toBeNull();
  });
});
