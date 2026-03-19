import { describe, expect, it } from "bun:test";
import { ContextWindowManager } from "../../src/agent/context-window";
import type { ContextWindowConfig } from "../../src/types/config";
import type { Message } from "../../src/types/llm";

// --- Helpers ---

function textMsg(role: "user" | "assistant", text: string): Message {
  return { content: [{ text, type: "text" }], role };
}

function systemMsg(text: string): Message {
  return { content: [{ text, type: "text" }], role: "system" };
}

function toolUseMsg(toolUseId: string, name: string, input: Record<string, unknown>): Message {
  return {
    content: [{ input, name, toolUseId, type: "tool_use" }],
    role: "assistant",
  };
}

function toolResultMsg(toolUseId: string, content: string): Message {
  return {
    content: [{ content, toolUseId, type: "tool_result" }],
    role: "user",
  };
}

/** Create a large string of specified char count */
function bigContent(chars: number): string {
  return "x".repeat(chars);
}

describe("ContextWindowManager", () => {
  const defaultConfig: ContextWindowConfig = {
    compactionThreshold: 0.85,
    maxContextTokens: 1000,
    pruneThreshold: 0.7,
  };

  // --- shouldPrune ---

  describe("shouldPrune", () => {
    it("returns false when estimated tokens below prune threshold", () => {
      const mgr = new ContextWindowManager(defaultConfig);
      // 1000 * 0.7 = 700 token threshold → 700*4 = 2800 chars needed
      // Small messages well below threshold
      const messages: Array<Message> = [
        textMsg("user", "hello"), // 5 chars → ~1 token
        textMsg("assistant", "hi there"), // 8 chars → 2 tokens
      ];
      expect(mgr.shouldPrune(messages)).toBe(false);
    });

    it("returns true when estimated tokens above prune threshold", () => {
      const mgr = new ContextWindowManager(defaultConfig);
      // Need > 700 tokens → > 2800 chars
      const messages: Array<Message> = [
        textMsg("user", bigContent(3000)), // 3000 chars → 750 tokens > 700
      ];
      expect(mgr.shouldPrune(messages)).toBe(true);
    });

    it("uses default pruneThreshold of 0.7 when not specified", () => {
      const mgr = new ContextWindowManager({ maxContextTokens: 100 });
      // Default threshold: 100 * 0.7 = 70 tokens → 280 chars
      const messages: Array<Message> = [textMsg("user", bigContent(300))]; // 300/4 = 75 > 70
      expect(mgr.shouldPrune(messages)).toBe(true);
    });
  });

  // --- prune ---

  describe("prune", () => {
    it("preserves messages[0] (system prompt) regardless of size", () => {
      const mgr = new ContextWindowManager({ maxContextTokens: 100, pruneThreshold: 0.1 });
      const messages: Array<Message> = [
        systemMsg(bigContent(400)), // explicit system-role prompt — large but must survive
        toolUseMsg("t1", "echo", { text: "hi" }),
        toolResultMsg("t1", bigContent(400)),
        textMsg("user", "final question"),
      ];

      const result = mgr.prune(messages);
      // messages[0] (system role) must be preserved exactly
      expect(result.pruned[0]).toEqual(messages[0]);
    });

    it("preserves last user message", () => {
      const mgr = new ContextWindowManager({ maxContextTokens: 100, pruneThreshold: 0.1 });
      const lastUserMsg = textMsg("user", "what is the answer?");
      const messages: Array<Message> = [
        textMsg("user", "system prompt"),
        toolUseMsg("t1", "scan", { target: "x" }),
        toolResultMsg("t1", bigContent(400)),
        lastUserMsg,
      ];

      const result = mgr.prune(messages);
      // Last message should be preserved
      const lastPruned = result.pruned.at(-1);
      expect(lastPruned).toEqual(lastUserMsg);
    });

    it("replaces old tool_result content with '[pruned]'", () => {
      const mgr = new ContextWindowManager({ maxContextTokens: 200, pruneThreshold: 0.1 });
      const messages: Array<Message> = [
        textMsg("user", "system prompt"),
        toolUseMsg("t1", "scan", { target: "example.com" }),
        toolResultMsg("t1", bigContent(800)), // large tool result
        textMsg("user", "next question"),
      ];

      const result = mgr.prune(messages);
      expect(result.removed).toBeGreaterThan(0);
      expect(result.tokensSaved).toBeGreaterThan(0);

      // Find pruned tool_result
      const prunedToolResult = result.pruned.find((m) =>
        m.content.some((c) => c.type === "tool_result" && c.toolUseId === "t1")
      );
      expect(prunedToolResult).toBeDefined();
      const toolResultBlock = prunedToolResult!.content.find(
        (c) => c.type === "tool_result" && c.toolUseId === "t1"
      );
      expect(toolResultBlock).toBeDefined();
      if (toolResultBlock && toolResultBlock.type === "tool_result") {
        expect(toolResultBlock.content).toBe("[pruned]");
      }
    });

    it("removes tool_use + tool_result as atomic pairs (no orphans)", () => {
      const mgr = new ContextWindowManager({ maxContextTokens: 200, pruneThreshold: 0.1 });
      const messages: Array<Message> = [
        textMsg("user", "system"),
        toolUseMsg("t1", "scan", { target: "a" }),
        toolResultMsg("t1", bigContent(600)),
        toolUseMsg("t2", "scan", { target: "b" }),
        toolResultMsg("t2", bigContent(600)),
        textMsg("user", "what now?"),
      ];

      const result = mgr.prune(messages);

      // After pruning, verify no orphaned tool_use or tool_result
      const allToolUseIds = new Set<string>();
      const allToolResultIds = new Set<string>();

      for (const msg of result.pruned) {
        for (const block of msg.content) {
          if (block.type === "tool_use") {
            allToolUseIds.add(block.toolUseId);
          }
          if (block.type === "tool_result") {
            allToolResultIds.add(block.toolUseId);
          }
        }
      }

      // Every tool_use must have corresponding tool_result and vice versa
      for (const id of allToolUseIds) {
        expect(allToolResultIds.has(id)).toBe(true);
      }
      for (const id of allToolResultIds) {
        expect(allToolUseIds.has(id)).toBe(true);
      }
    });

    it("protects most recent N tool pairs from pruning", () => {
      const mgr = new ContextWindowManager({ maxContextTokens: 500, pruneThreshold: 0.1 });
      // Create 5 tool pairs, only old ones should be pruned
      const messages: Array<Message> = [
        textMsg("user", "system"),
        // Old pairs (should be prunable)
        toolUseMsg("t1", "scan", { target: "a" }),
        toolResultMsg("t1", bigContent(200)),
        toolUseMsg("t2", "scan", { target: "b" }),
        toolResultMsg("t2", bigContent(200)),
        // Recent pairs (should be protected - last 3)
        toolUseMsg("t3", "scan", { target: "c" }),
        toolResultMsg("t3", bigContent(200)),
        toolUseMsg("t4", "scan", { target: "d" }),
        toolResultMsg("t4", bigContent(200)),
        toolUseMsg("t5", "scan", { target: "e" }),
        toolResultMsg("t5", bigContent(200)),
        textMsg("user", "final"),
      ];

      const result = mgr.prune(messages);

      // Recent tool results (t3, t4, t5) should NOT be pruned
      for (const recentId of ["t3", "t4", "t5"]) {
        const toolResultBlock = result.pruned
          .flatMap((m) => m.content)
          .find((c) => c.type === "tool_result" && c.toolUseId === recentId);
        expect(toolResultBlock).toBeDefined();
        if (toolResultBlock && toolResultBlock.type === "tool_result") {
          expect(toolResultBlock.content).not.toBe("[pruned]");
        }
      }

      // Old tool results (t1, t2) should be pruned
      for (const oldId of ["t1", "t2"]) {
        const toolResultBlock = result.pruned
          .flatMap((m) => m.content)
          .find((c) => c.type === "tool_result" && c.toolUseId === oldId);
        expect(toolResultBlock).toBeDefined();
        if (toolResultBlock && toolResultBlock.type === "tool_result") {
          expect(toolResultBlock.content).toBe("[pruned]");
        }
      }
    });

    it("returns correct removed count and tokensSaved", () => {
      const mgr = new ContextWindowManager({ maxContextTokens: 200, pruneThreshold: 0.1 });
      const bigStr = bigContent(400); // 400 chars → 100 tokens
      const messages: Array<Message> = [
        textMsg("user", "system"),
        toolUseMsg("t1", "scan", { target: "x" }),
        toolResultMsg("t1", bigStr),
        textMsg("user", "done"),
      ];

      const result = mgr.prune(messages);
      expect(result.removed).toBeGreaterThan(0);
      expect(result.tokensSaved).toBeGreaterThan(0);
      // tokensSaved should be roughly the tokens from the pruned content
      // bigStr = 400 chars → 100 tokens, "[pruned]" = 8 chars → 2 tokens
      // Saved ≈ 100 - 2 = 98 tokens
      expect(result.tokensSaved).toBeGreaterThanOrEqual(90);
    });

    it("returns unchanged messages when nothing to prune", () => {
      const mgr = new ContextWindowManager({ maxContextTokens: 10_000, pruneThreshold: 0.7 });
      const messages: Array<Message> = [
        textMsg("user", "system prompt"),
        textMsg("assistant", "hello"),
        textMsg("user", "how are you?"),
      ];

      const result = mgr.prune(messages);
      expect(result.pruned).toEqual(messages);
      expect(result.removed).toBe(0);
      expect(result.tokensSaved).toBe(0);
    });

    it("handles messages with mixed content blocks", () => {
      const mgr = new ContextWindowManager({ maxContextTokens: 200, pruneThreshold: 0.1 });
      const messages: Array<Message> = [
        textMsg("user", "system"),
        {
          content: [
            { text: "I will scan", type: "text" },
            { input: { target: "x" }, name: "scan", toolUseId: "t1", type: "tool_use" },
          ],
          role: "assistant",
        },
        toolResultMsg("t1", bigContent(600)),
        textMsg("user", "next"),
      ];

      const result = mgr.prune(messages);
      // tool_result t1 should be pruned
      const toolResultBlock = result.pruned
        .flatMap((m) => m.content)
        .find((c) => c.type === "tool_result" && c.toolUseId === "t1");
      expect(toolResultBlock).toBeDefined();
      if (toolResultBlock && toolResultBlock.type === "tool_result") {
        expect(toolResultBlock.content).toBe("[pruned]");
      }

      // The tool_use should still exist (paired with pruned result)
      const toolUseBlock = result.pruned
        .flatMap((m) => m.content)
        .find((c) => c.type === "tool_use" && c.toolUseId === "t1");
      expect(toolUseBlock).toBeDefined();
    });
  });

  // --- shouldCompact ---

  describe("shouldCompact", () => {
    it("returns true when estimated tokens above compaction threshold", () => {
      const mgr = new ContextWindowManager(defaultConfig);
      // 1000 * 0.85 = 850 tokens → 3400 chars
      const messages: Array<Message> = [textMsg("user", bigContent(3600))]; // 900 tokens > 850
      expect(mgr.shouldCompact(messages)).toBe(true);
    });

    it("returns false when estimated tokens below compaction threshold", () => {
      const mgr = new ContextWindowManager(defaultConfig);
      const messages: Array<Message> = [textMsg("user", bigContent(100))]; // 25 tokens < 850
      expect(mgr.shouldCompact(messages)).toBe(false);
    });

    it("uses default compactionThreshold of 0.85 when not specified", () => {
      const mgr = new ContextWindowManager({ maxContextTokens: 100 });
      // Default: 100 * 0.85 = 85 tokens → 340 chars
      const messages: Array<Message> = [textMsg("user", bigContent(360))]; // 90 tokens > 85
      expect(mgr.shouldCompact(messages)).toBe(true);
    });
  });

  // --- updateUsage ---

  describe("updateUsage", () => {
    it("stores actual token usage values", () => {
      const mgr = new ContextWindowManager(defaultConfig);
      mgr.updateUsage({ inputTokens: 500, outputTokens: 200 });
      // Accessing internal state — verify through shouldPrune behavior or getter
      expect(mgr.lastUsage).toEqual({ inputTokens: 500, outputTokens: 200 });
    });

    it("overwrites previous usage on subsequent calls", () => {
      const mgr = new ContextWindowManager(defaultConfig);
      mgr.updateUsage({ inputTokens: 100, outputTokens: 50 });
      mgr.updateUsage({ inputTokens: 800, outputTokens: 300 });
      expect(mgr.lastUsage).toEqual({ inputTokens: 800, outputTokens: 300 });
    });

    it("starts with undefined usage before any update", () => {
      const mgr = new ContextWindowManager(defaultConfig);
      expect(mgr.lastUsage).toBeUndefined();
    });
  });

  // --- Edge cases ---

  describe("edge cases", () => {
    it("handles empty message array", () => {
      const mgr = new ContextWindowManager(defaultConfig);
      expect(mgr.shouldPrune([])).toBe(false);
      expect(mgr.shouldCompact([])).toBe(false);
      const result = mgr.prune([]);
      expect(result.pruned).toEqual([]);
      expect(result.removed).toBe(0);
      expect(result.tokensSaved).toBe(0);
    });

    it("handles single system message", () => {
      const mgr = new ContextWindowManager({ maxContextTokens: 10, pruneThreshold: 0.1 });
      const messages: Array<Message> = [systemMsg(bigContent(400))];
      // Even if above threshold, single message (system prompt) must be preserved
      const result = mgr.prune(messages);
      expect(result.pruned[0]).toEqual(messages[0]);
    });

    it("does not mutate original messages array", () => {
      const mgr = new ContextWindowManager({ maxContextTokens: 200, pruneThreshold: 0.1 });
      const originalContent = bigContent(600);
      const messages: Array<Message> = [
        textMsg("user", "system"),
        toolUseMsg("t1", "scan", { target: "x" }),
        toolResultMsg("t1", originalContent),
        textMsg("user", "done"),
      ];

      const originalLength = messages.length;
      const _result = mgr.prune(messages);

      // Original array unchanged
      expect(messages.length).toBe(originalLength);
      // Original tool_result content unchanged
      const originalToolResult = messages[2].content[0];
      if (originalToolResult.type === "tool_result") {
        expect(originalToolResult.content).toBe(originalContent);
      }
    });
  });
});
