import { describe, expect, test } from "bun:test";
import {
  buildToolResultMessages,
  buildToolResultMessagesWithTruncation,
  computeTruncationThreshold,
  truncateToolResult,
} from "../../src/agent/message-builder";
import { InMemoryBlobStore } from "../../src/blob/in-memory";
import type { BlobStore } from "../../src/blob/types";

describe("computeTruncationThreshold", () => {
  test("computes threshold as contextWindowSize * 0.05 / 4", () => {
    expect(computeTruncationThreshold(200_000)).toBe(2500);
    expect(computeTruncationThreshold(100_000)).toBe(1250);
    expect(computeTruncationThreshold(0)).toBe(0);
  });
});

describe("truncateToolResult", () => {
  const threshold = 2500;

  test("passes through results below threshold", async () => {
    const shortResult = "a".repeat(threshold - 1);
    const truncated = await truncateToolResult(shortResult, threshold);
    expect(truncated.content).toBe(shortResult);
    expect(truncated.fullOutputRef).toBeUndefined();
  });

  test("truncates results exceeding threshold without blobStore", async () => {
    const longResult = "x".repeat(threshold + 500);
    const truncated = await truncateToolResult(longResult, threshold);
    expect(truncated.content.length).toBeLessThanOrEqual(threshold + 200);
    expect(truncated.content).toContain("x".repeat(threshold));
    expect(truncated.content).toContain("[Output truncated at");
    expect(truncated.content).not.toContain("ref:");
    expect(truncated.fullOutputRef).toBeUndefined();
  });

  test("truncates with blobStore and includes ref", async () => {
    const blobStore = new InMemoryBlobStore();
    const longResult = "y".repeat(threshold + 500);
    const truncated = await truncateToolResult(longResult, threshold, blobStore);
    expect(truncated.content).toContain("[Output truncated at");
    expect(truncated.content).toContain("ref:");
    expect(truncated.content).toContain("read_tool_output");
    expect(truncated.fullOutputRef).toBeDefined();
    expect(truncated.fullOutputRef).toMatch(/^tool-output-\d+$/);

    const stored = await blobStore.get(truncated.fullOutputRef!);
    expect(stored).not.toBeNull();
    expect(stored!.toString()).toBe(longResult);
  });

  test("handles blobStore.put() failure gracefully", async () => {
    const failingStore: BlobStore = {
      async delete(): Promise<void> {},
      async get(): Promise<Buffer | null> {
        return null;
      },
      async put(): Promise<string> {
        throw new Error("Storage full");
      },
    };

    const longResult = "z".repeat(threshold + 500);
    const truncated = await truncateToolResult(longResult, threshold, failingStore);
    expect(truncated.content).toContain("[Output truncated at");
    expect(truncated.content).not.toContain("ref:");
    expect(truncated.fullOutputRef).toBeUndefined();
  });

  test("exact threshold length passes through", async () => {
    const exactResult = "a".repeat(threshold);
    const truncated = await truncateToolResult(exactResult, threshold);
    expect(truncated.content).toBe(exactResult);
    expect(truncated.fullOutputRef).toBeUndefined();
  });
});

describe("buildToolResultMessages with truncation", () => {
  test("truncates tool results when truncationConfig provided", async () => {
    const longResult = "R".repeat(5000);
    const results = [{ result: longResult, toolUseId: "t1" }];

    const messages = await buildToolResultMessagesWithTruncation(results, {
      active: true,
      config: { threshold: 2500 },
    });

    expect(messages).toHaveLength(1);
    const content = messages[0].content[0];
    expect(content.type).toBe("tool_result");
    if (content.type === "tool_result") {
      expect(content.content.length).toBeLessThan(longResult.length);
      expect(content.content).toContain("[Output truncated at");
      expect(content.fullOutputRef).toBeUndefined();
    }
  });

  test("no truncation when truncationConfig absent", () => {
    const longResult = "R".repeat(5000);
    const results = [{ result: longResult, toolUseId: "t1" }];

    const messages = buildToolResultMessages(results);

    expect(messages).toHaveLength(1);
    const content = messages[0].content[0];
    if (content.type === "tool_result") {
      expect(content.content).toBe(longResult);
    }
  });

  test("stores in blobStore when configured and result exceeds threshold", async () => {
    const blobStore = new InMemoryBlobStore();
    const longResult = "S".repeat(5000);
    const results = [{ result: longResult, toolUseId: "t1" }];

    const messages = await buildToolResultMessagesWithTruncation(results, {
      active: true,
      config: { blobStore, threshold: 2500 },
    });

    expect(messages).toHaveLength(1);
    const block = messages[0].content[0];
    expect(block.type).toBe("tool_result");
    if (block.type === "tool_result") {
      expect(block.content).toContain("ref:");
      expect(block.fullOutputRef).toBeDefined();
      expect(block.fullOutputRef).toMatch(/^tool-output-\d+$/);
      const stored = await blobStore.get(block.fullOutputRef!);
      expect(stored).not.toBeNull();
    }
  });

  test("includes fullOutputRef in message when blobStore is used", async () => {
    const blobStore = new InMemoryBlobStore();
    const longResult = "T".repeat(10_000);
    const results = [
      { result: longResult, toolUseId: "t1" },
      { result: "short", toolUseId: "t2" },
    ];

    const messages = await buildToolResultMessagesWithTruncation(results, {
      active: true,
      config: { blobStore, threshold: 2500 },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toHaveLength(2);

    const block1 = messages[0].content[0];
    expect(block1.type).toBe("tool_result");
    if (block1.type === "tool_result") {
      expect(block1.fullOutputRef).toBeDefined();
      expect(block1.fullOutputRef).toMatch(/^tool-output-\d+$/);
    }

    const block2 = messages[0].content[1];
    expect(block2.type).toBe("tool_result");
    if (block2.type === "tool_result") {
      expect(block2.fullOutputRef).toBeUndefined();
    }
  });
});
