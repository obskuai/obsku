import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type {
  AgentEvent,
  ContextWindowConfig,
  LLMCallContext,
  LLMProvider,
  Message,
} from "../../src/types";
import { defaultConfig, makeEmit, makePlugin, makeProvider } from "../utils/helpers";
import { runReactLoop, runStreamReactLoop } from "../utils/loop-helpers";
import { textResponse, toolResponse } from "../utils/responses";

// Helper: create messages array with enough tokens to trigger thresholds
function makeLargeMessages(tokenTarget: number): Array<Message> {
  // ~4 chars per token estimate
  const charTarget = tokenTarget * 4;
  const msgs: Array<Message> = [
    { content: [{ text: "You are a helpful assistant.", type: "text" }], role: "user" },
  ];

  // Build tool pairs to have prunable content
  const pairsNeeded = Math.ceil(charTarget / 400); // ~100 tokens per pair
  for (let i = 0; i < pairsNeeded; i++) {
    const toolUseId = `tool-${i}`;
    msgs.push({
      content: [
        {
          input: { text: "x".repeat(100) },
          name: "echo",
          toolUseId,
          type: "tool_use",
        },
      ],
      role: "assistant",
    });
    msgs.push({
      content: [
        {
          content: "y".repeat(200),
          toolUseId,
          type: "tool_result",
        },
      ],
      role: "user",
    });
  }
  // Final user message
  msgs.push({
    content: [{ text: "Now summarize everything.", type: "text" }],
    role: "user",
  });
  return msgs;
}

describe("Context Window Integration", () => {
  test("agent WITHOUT contextWindow → no events, identical behavior", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeProvider(async () => textResponse("done"));

    const result = await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events)
      )
    );

    expect(result).toBe("done");
    const contextEvents = events.filter(
      (e) => e.type === "context.pruned" || e.type === "context.compacted"
    );
    expect(contextEvents).toHaveLength(0);
  });

  test("agent WITH contextWindow, messages below threshold → no events", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeProvider(async () => textResponse("done"));

    // maxContextTokens=100000 with small messages = well below threshold
    const contextWindow: ContextWindowConfig = { maxContextTokens: 100_000 };

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

  test("agent WITH contextWindow, messages above prune threshold → ContextPruned event", async () => {
    const events: Array<AgentEvent> = [];
    let callCount = 0;

    // Provider returns tool calls first, then text
    const provider = makeProvider(async () => {
      callCount++;
      if (callCount === 1) {
        return toolResponse([{ id: "t1", input: { text: "x".repeat(200) }, name: "echo" }]);
      }
      return textResponse("done");
    });

    // Low maxContextTokens so initial messages + tool results trigger prune
    const contextWindow: ContextWindowConfig = { maxContextTokens: 200, pruneThreshold: 0.1 };

    // Start with enough messages to be above prune threshold after first iteration
    const messages = makeLargeMessages(200);

    const _result = await Effect.runPromise(
      runReactLoop(
        messages,
        [{ description: "echo", inputSchema: { properties: {}, type: "object" }, name: "echo" }],
        new Map([["echo", makePlugin("echo", "ok")]]),
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

    const pruneEvents = events.filter((e) => e.type === "context.pruned");
    expect(pruneEvents.length).toBeGreaterThanOrEqual(1);

    const pruneEvent = pruneEvents[0] as {
      estimatedTokensSaved: number;
      removedMessages: number;
      type: "context.pruned";
    };
    expect(pruneEvent.removedMessages).toBeGreaterThan(0);
    expect(pruneEvent.estimatedTokensSaved).toBeGreaterThan(0);
  });

  test("agent WITH contextWindow, above compact threshold → ContextCompacted event", async () => {
    const events: Array<AgentEvent> = [];
    let callCount = 0;

    // Compaction provider returns a short summary
    const compactionProvider: LLMProvider = {
      chat: async () => textResponse("Summary of conversation"),
      chatStream: async function* () {
        yield { content: "", type: "text_delta" as const };
      },
      contextWindowSize: 200_000,
    };

    // Main provider
    const provider = makeProvider(async () => {
      callCount++;
      if (callCount === 1) {
        return toolResponse([{ id: "t1", input: {}, name: "echo" }]);
      }
      return textResponse("done");
    });

    // Very low thresholds so compaction triggers
    const contextWindow: ContextWindowConfig = {
      compactionProvider,
      compactionThreshold: 0.1,
      maxContextTokens: 100,
      pruneThreshold: 0.05,
    };

    const messages = makeLargeMessages(200);

    const _result = await Effect.runPromise(
      runReactLoop(
        messages,
        [{ description: "echo", inputSchema: { properties: {}, type: "object" }, name: "echo" }],
        new Map([["echo", makePlugin("echo", "ok")]]),
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

    const compactEvents = events.filter((e) => e.type === "context.compacted");
    expect(compactEvents.length).toBeGreaterThanOrEqual(1);

    const compactEvent = compactEvents[0] as {
      compactedMessages: number;
      estimatedTokensSaved: number;
      originalMessages: number;
      type: "context.compacted";
    };
    expect(compactEvent.originalMessages).toBeGreaterThan(0);
    expect(compactEvent.estimatedTokensSaved).toBeGreaterThan(0);
  });

  test("compaction failure → hard-truncate fallback, agent continues", async () => {
    const events: Array<AgentEvent> = [];
    let callCount = 0;

    // Compaction provider that always fails
    const compactionProvider: LLMProvider = {
      chat: async () => {
        throw new Error("Compaction LLM failure");
      },
      chatStream: async function* () {
        yield { content: "", type: "text_delta" as const };
      },
      contextWindowSize: 200_000,
    };

    const provider = makeProvider(async () => {
      callCount++;
      if (callCount === 1) {
        return toolResponse([{ id: "t1", input: {}, name: "echo" }]);
      }
      return textResponse("done");
    });

    const contextWindow: ContextWindowConfig = {
      compactionProvider,
      compactionThreshold: 0.1,
      maxContextTokens: 100,
      pruneThreshold: 0.05,
    };

    const messages = makeLargeMessages(200);

    // Should NOT throw, agent continues with fallback
    const result = await Effect.runPromise(
      runReactLoop(
        messages,
        [{ description: "echo", inputSchema: { properties: {}, type: "object" }, name: "echo" }],
        new Map([["echo", makePlugin("echo", "ok")]]),
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

    // Agent should complete despite compaction failure
    expect(typeof result).toBe("string");

    // ContextCompacted event still emitted (with fallback stats)
    const compactEvents = events.filter((e) => e.type === "context.compacted");
    expect(compactEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("streaming mode → context window works", async () => {
    const events: Array<AgentEvent> = [];

    const streamProvider: LLMProvider = {
      chat: async () => textResponse("non-stream"),
      chatStream: async function* () {
        yield { content: "Hello World", type: "text_delta" };
        yield {
          stopReason: "end_turn",
          type: "message_end",
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      contextWindowSize: 200_000,
    };

    // Very low threshold to trigger prune on initial messages
    const contextWindow: ContextWindowConfig = { maxContextTokens: 200, pruneThreshold: 0.1 };
    const messages = makeLargeMessages(200);

    const result = await Effect.runPromise(
      runStreamReactLoop(
        messages,
        [],
        new Map(),
        streamProvider,
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

    expect(typeof result).toBe("string");
    const pruneEvents = events.filter((e) => e.type === "context.pruned");
    expect(pruneEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("compactionProvider specified → used instead of agent provider", async () => {
    const events: Array<AgentEvent> = [];
    let compactionProviderCalled = false;
    let mainProviderCallCount = 0;

    const compactionProvider: LLMProvider = {
      chat: async () => {
        compactionProviderCalled = true;
        return textResponse("Compact summary");
      },
      chatStream: async function* () {
        yield { content: "", type: "text_delta" as const };
      },
      contextWindowSize: 200_000,
    };

    const provider = makeProvider(async () => {
      mainProviderCallCount++;
      if (mainProviderCallCount === 1) {
        return toolResponse([{ id: "t1", input: {}, name: "echo" }]);
      }
      return textResponse("done");
    });

    const contextWindow: ContextWindowConfig = {
      compactionProvider,
      compactionThreshold: 0.1,
      maxContextTokens: 100,
      pruneThreshold: 0.05,
    };

    const messages = makeLargeMessages(200);

    await Effect.runPromise(
      runReactLoop(
        messages,
        [{ description: "echo", inputSchema: { properties: {}, type: "object" }, name: "echo" }],
        new Map([["echo", makePlugin("echo", "ok")]]),
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

    // Compaction provider should be used (not main provider)
    expect(compactionProviderCalled).toBe(true);
  });

  test("compactionProvider fallback → uses agent provider when not specified", async () => {
    const events: Array<AgentEvent> = [];
    let providerCallCount = 0;

    const provider = makeProvider(async () => {
      providerCallCount++;
      // First call = compaction summarization (if triggered)
      // Or it could be a regular call
      if (providerCallCount <= 2) {
        return textResponse("Summary or regular response");
      }
      return textResponse("done");
    });

    const contextWindow: ContextWindowConfig = {
      compactionThreshold: 0.1,
      maxContextTokens: 100,
      pruneThreshold: 0.05,
      // No compactionProvider → should fall back to agent's provider
    };

    const messages = makeLargeMessages(200);

    await Effect.runPromise(
      runReactLoop(
        messages,
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

    // Agent's provider should have been used for compaction
    // We verify this by checking that compaction event was emitted
    // (if compaction triggered, it had to use the agent's provider)
    const compactEvents = events.filter((e) => e.type === "context.compacted");
    expect(compactEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("context window checks run BEFORE user beforeLLMCall hook", async () => {
    const events: Array<AgentEvent> = [];
    const executionOrder: Array<string> = [];

    const provider = makeProvider(async () => textResponse("done"));

    const beforeLLMCall = (_ctx: LLMCallContext) => {
      executionOrder.push("user-hook");
    };

    // Patch: we track if prune happens via event emission order
    const contextWindow: ContextWindowConfig = { maxContextTokens: 200, pruneThreshold: 0.1 };
    const messages = makeLargeMessages(200);

    await Effect.runPromise(
      runReactLoop(
        messages,
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        (event: AgentEvent) => {
          events.push(event);
          if (event.type === "context.pruned") {
            executionOrder.push("context-pruned");
          }
          return Effect.succeed(true);
        },
        undefined, // stopWhen
        undefined, // onStepFinish
        undefined, // outputGuardrails
        undefined, // onToolResult
        undefined, // handoffTargets
        undefined, // agentName
        undefined, // sessionId
        undefined, // telemetryConfig
        beforeLLMCall,
        undefined, // afterLLMCall
        undefined, // onEntityExtract
        contextWindow
      )
    );

    // Context pruning should happen BEFORE user hook
    expect(executionOrder[0]).toBe("context-pruned");
    expect(executionOrder[1]).toBe("user-hook");
  });

  test("usage tracking after LLM response", async () => {
    const events: Array<AgentEvent> = [];

    const provider = makeProvider(async () => ({
      content: [{ text: "done", type: "text" as const }],
      stopReason: "end_turn" as const,
      usage: { inputTokens: 500, outputTokens: 100 },
    }));

    const contextWindow: ContextWindowConfig = { maxContextTokens: 100_000 };

    await Effect.runPromise(
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

    // Agent should complete normally (usage tracking is internal)
    const completeEvents = events.filter((e) => e.type === "agent.complete");
    expect(completeEvents).toHaveLength(1);
  });
});
