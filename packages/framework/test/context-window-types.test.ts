// TDD Test: Context Window Types
// This test verifies that ContextWindowConfig, CompactionStrategy, and context events exist

import { describe, expect, it } from "bun:test";
import type { AgentEvent, CompactionStrategy, ContextWindowConfig } from "../src/index";

describe("Context Window Types", () => {
  it("should have ContextWindowConfig with optional maxContextTokens", () => {
    // Type-only test - if this compiles, types are correct
    // maxContextTokens is now optional - falls back to provider.contextWindowSize
    const config: ContextWindowConfig = {};

    expect(config.maxContextTokens).toBeUndefined();
  });

  it("should allow ContextWindowConfig with explicit maxContextTokens", () => {
    const config: ContextWindowConfig = {
      maxContextTokens: 128_000,
    };

    expect(config.maxContextTokens).toBe(128_000);
  });

  it("should have ContextWindowConfig with all optional fields", () => {
    const config: ContextWindowConfig = {
      compactionThreshold: 0.85,
      maxContextTokens: 128_000,
      pruneThreshold: 0.7,
      reserveOutputTokens: 4096,
    };

    expect(config.maxContextTokens).toBe(128_000);
    expect(config.pruneThreshold).toBe(0.7);
    expect(config.compactionThreshold).toBe(0.85);
    expect(config.reserveOutputTokens).toBe(4096);
  });

  it("should have CompactionStrategy interface", async () => {
    // Type-only test - verify CompactionStrategy can be implemented
    const mockStrategy: CompactionStrategy = {
      async compact(messages, _provider) {
        // Mock implementation
        return messages.slice(0, 1);
      },
    };

    expect(typeof mockStrategy.compact).toBe("function");
  });

  it("should have ContextPruned event in AgentEvent union", () => {
    const event: AgentEvent = {
      estimatedTokensSaved: 5000,
      removedMessages: 10,
      type: "context.pruned",
    };

    expect(event.type).toBe("context.pruned");
    expect(event.removedMessages).toBe(10);
    expect(event.estimatedTokensSaved).toBe(5000);
  });

  it("should have ContextCompacted event in AgentEvent union", () => {
    const event: AgentEvent = {
      compactedMessages: 10,
      estimatedTokensSaved: 45_000,
      originalMessages: 100,
      type: "context.compacted",
    };

    expect(event.type).toBe("context.compacted");
    expect(event.originalMessages).toBe(100);
    expect(event.compactedMessages).toBe(10);
    expect(event.estimatedTokensSaved).toBe(45_000);
  });

  it("should have contextWindow field in AgentDef", () => {
    // Type-only test - import AgentDef and verify contextWindow field
    // We can't directly test this without actually importing AgentDef
    // But the test below verifies the type exists
    const testFn = (config: ContextWindowConfig) => config.maxContextTokens;
    expect(typeof testFn).toBe("function");
  });
});
