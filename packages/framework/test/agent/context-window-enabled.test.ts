import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { resolveContextWindow } from "../../src/agent/context-window-resolve";
import type { AgentEvent, ContextWindowConfig, LLMProvider } from "../../src/types";
import { defaultConfig, makeEmit, makeProvider } from "../utils/helpers";
import { runReactLoop } from "../utils/loop-helpers";
import { textResponse } from "../utils/responses";

describe("resolveContextWindow — activation matrix", () => {
  test("no config → inactive", () => {
    const result = resolveContextWindow(undefined, 200_000);
    expect(result).toEqual({ active: false });
  });

  test("empty config {} → inactive", () => {
    const result = resolveContextWindow({}, 200_000);
    expect(result).toEqual({ active: false });
  });

  test("maxContextTokens set → active with that maxContextTokens", () => {
    const result = resolveContextWindow({ maxContextTokens: 150_000 }, undefined);
    expect(result).toEqual({
      active: true,
      config: { maxContextTokens: 150_000 },
    });
  });

  test("enabled: true + provider contextWindowSize → active, maxContextTokens from provider", () => {
    const result = resolveContextWindow({ enabled: true }, 200_000);
    expect(result).toEqual({
      active: true,
      config: { enabled: true, maxContextTokens: 200_000 },
    });
  });

  test("enabled: true, no provider fallback → throws", () => {
    expect(() => resolveContextWindow({ enabled: true }, undefined)).toThrow(
      /maxContextTokens cannot be resolved/
    );
  });

  test("enabled: false → inactive (even with provider size)", () => {
    const result = resolveContextWindow({ enabled: false }, 200_000);
    expect(result).toEqual({ active: false });
  });

  test("enabled: false + maxContextTokens set → inactive", () => {
    const result = resolveContextWindow({ enabled: false, maxContextTokens: 150_000 }, 200_000);
    expect(result).toEqual({ active: false });
  });

  test("maxContextTokens: 0 → throws (guard)", () => {
    expect(() => resolveContextWindow({ maxContextTokens: 0 }, 200_000)).toThrow();
  });

  test("enabled: true + maxContextTokens → active, uses explicit maxContextTokens (not provider)", () => {
    const result = resolveContextWindow({ enabled: true, maxContextTokens: 100_000 }, 200_000);
    expect(result).toEqual({
      active: true,
      config: { enabled: true, maxContextTokens: 100_000 },
    });
  });
});

describe("resolveContextWindow — edge cases", () => {
  test("maxContextTokens negative → throws", () => {
    expect(() => resolveContextWindow({ maxContextTokens: -1 }, 200_000)).toThrow();
  });

  test("enabled: true, provider size 0 → throws", () => {
    expect(() => resolveContextWindow({ enabled: true }, 0)).toThrow();
  });

  test("preserves extra config fields when active", () => {
    const result = resolveContextWindow(
      { compactionThreshold: 0.9, maxContextTokens: 100_000, pruneThreshold: 0.5 },
      200_000
    );
    expect(result.active).toBe(true);
    if (result.active) {
      expect(result.config.pruneThreshold).toBe(0.5);
      expect(result.config.compactionThreshold).toBe(0.9);
      expect(result.config.maxContextTokens).toBe(100_000);
    }
  });
});

describe("Context Window enabled — integration", () => {
  test("contextWindow: {} + provider with contextWindowSize → NO CW events", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeProvider(async () => textResponse("done"));
    const contextWindow: ContextWindowConfig = {};

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events),
        undefined, // stopWhen
        undefined, // onStepFinish
        undefined, // outputGuardrails
        undefined, // onToolResult
        undefined, // handoffTargets
        undefined, // agentName
        undefined, // sessionId
        undefined, // telemetryConfig
        undefined, // beforeLLMCall
        undefined, // afterLLMCall
        undefined, // onEntityExtract
        contextWindow
      )
    );

    expect(result).toBe("done");
    const contextEvents = events.filter(
      (e) => e.type === "context.pruned" || e.type === "context.compacted"
    );
    expect(contextEvents).toHaveLength(0);
  });

  test("enabled: false + maxContextTokens → NO CW events", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeProvider(async () => textResponse("done"));

    const contextWindow: ContextWindowConfig = { enabled: false, maxContextTokens: 100 };

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events),
        undefined, // stopWhen
        undefined, // onStepFinish
        undefined, // outputGuardrails
        undefined, // onToolResult
        undefined, // handoffTargets
        undefined, // agentName
        undefined, // sessionId
        undefined, // telemetryConfig
        undefined, // beforeLLMCall
        undefined, // afterLLMCall
        undefined, // onEntityExtract
        contextWindow
      )
    );

    expect(result).toBe("done");
    const contextEvents = events.filter(
      (e) => e.type === "context.pruned" || e.type === "context.compacted"
    );
    expect(contextEvents).toHaveLength(0);
  });

  test("enabled: true → CW active via provider fallback", async () => {
    const events: Array<AgentEvent> = [];
    const provider: LLMProvider = {
      chat: async () => textResponse("done"),
      chatStream: async function* () {
        yield { content: "", type: "text_delta" as const };
      },
      contextWindowSize: 200_000,
    };

    const contextWindow: ContextWindowConfig = { enabled: true };

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events),
        undefined, // stopWhen
        undefined, // onStepFinish
        undefined, // outputGuardrails
        undefined, // onToolResult
        undefined, // handoffTargets
        undefined, // agentName
        undefined, // sessionId
        undefined, // telemetryConfig
        undefined, // beforeLLMCall
        undefined, // afterLLMCall
        undefined, // onEntityExtract
        contextWindow
      )
    );

    expect(result).toBe("done");
  });
});
