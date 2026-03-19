// =============================================================================
// @obsku/framework — Context window management
// =============================================================================
//
// STRATEGY OVERVIEW
// -----------------
// Two independent strategies reduce the context window when it grows too large:
//
//   1. TRUNCATION  (→ prune.ts)
//      Replaces old tool-result content with "[pruned]" in-place.
//      Fast, deterministic, zero LLM calls.
//      Triggered at `pruneThreshold` (default 0.7 × maxContextTokens).
//
//   2. SUMMARIZATION  (→ compaction.ts)
//      Calls an LLM to produce a narrative summary of the middle portion of
//      the conversation, then replaces those messages with the summary.
//      More token-efficient but requires an extra LLM round-trip.
//      Triggered at `compactionThreshold` (default 0.85 × maxContextTokens).
//
// TOKEN ESTIMATION vs ACTUAL TOKEN USAGE
// ---------------------------------------
// Gate decisions (shouldPrune / shouldCompact) rely on *estimated* token
// counts produced by `estimateMessageTokens()` — a cheap chars÷4 heuristic.
// Estimates are computed BEFORE the LLM API call because we don't yet know
// the real count.
//
// The *actual* token counts reported by the LLM API after each request are
// stored via `updateUsage()` / `lastUsage`.  These are useful for monitoring
// and metrics but are NOT used for prune/compact gating — by the time they
// are available the request has already been sent.
//
//   estimated tokens  →  shouldPrune / shouldCompact decisions (pre-request)
//   actual tokens     →  lastUsage / updateUsage              (post-request)
// =============================================================================

import { Effect } from "effect";
import { DEFAULTS } from "../defaults";
import type { CompactionStrategy } from "../types/compaction";
import type { ContextWindowConfig } from "../types/context-window-config";
import type { Logger } from "../types/plugin-config";
import type { AgentEvent } from "../types/events/index";
import type { Message } from "../types/llm";
import type { LLMProvider } from "../types/providers";
import { formatError } from "../utils";
import { telemetryLog } from "../telemetry/log";
import { DefaultCompactionStrategy } from "./compaction";
import { estimateMessageTokens } from "./token-estimation";
import { pruneMessages } from "./prune";
import type { PruneResult } from "./prune";

export interface ApplyContextWindowResult {
  compacted: { compactedCount: number; originalCount: number; tokensSaved: number } | null;
  messages: Array<Message>;
  pruned: { removed: number; tokensSaved: number } | null;
}

export function applyContextWindow(
  messages: Array<Message>,
  manager: ContextWindowManager,
  provider: LLMProvider,
  strategy?: CompactionStrategy
): Effect.Effect<ApplyContextWindowResult> {
  return Effect.gen(function* () {
    const compactionStrategy = strategy ?? new DefaultCompactionStrategy();
    let current = messages;
    let pruned: ApplyContextWindowResult["pruned"] = null;
    let compacted: ApplyContextWindowResult["compacted"] = null;

    if (manager.shouldPrune(current)) {
      const result = manager.prune(current);
      current = result.pruned;
      pruned = { removed: result.removed, tokensSaved: result.tokensSaved };
    }

    if (manager.shouldCompact(current)) {
      const result = yield* Effect.promise(() =>
        manager.compact(current, provider, compactionStrategy)
      );
      compacted = {
        compactedCount: result.compacted.length,
        originalCount: result.originalCount,
        tokensSaved: result.tokensSaved,
      };
      current = result.compacted;
    }

    return { compacted, messages: current, pruned };
  });
}

export function emitContextWindowEvents(
  cwResult: ApplyContextWindowResult,
  emit: (event: AgentEvent) => Effect.Effect<boolean>
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (cwResult.pruned) {
      yield* emit({
        estimatedTokensSaved: cwResult.pruned.tokensSaved,
        removedMessages: cwResult.pruned.removed,
        timestamp: Date.now(),
        type: "context.pruned",
      });
    }
    if (cwResult.compacted) {
      yield* emit({
        compactedMessages: cwResult.compacted.compactedCount,
        estimatedTokensSaved: cwResult.compacted.tokensSaved,
        originalMessages: cwResult.compacted.originalCount,
        timestamp: Date.now(),
        type: "context.compacted",
      });
    }
  });
}

export class ContextWindowManager {
  private readonly config: ContextWindowConfig;
  private readonly logger?: Logger;
  /**
   * Actual token usage reported by the LLM API after the most recent request.
   *
   * NOTE: This is *actual* usage (post-request), distinct from the *estimated*
   * token counts used by `shouldPrune` / `shouldCompact` (pre-request heuristic).
   */
  private _lastUsage: { inputTokens: number; outputTokens: number } | undefined;

  constructor(config: ContextWindowConfig, logger?: Logger) {
    if (!config.maxContextTokens || config.maxContextTokens <= 0) {
      throw new Error("ContextWindowManager requires maxContextTokens > 0");
    }
    this.config = config;
    this.logger = logger;
  }

  /**
   * Actual token usage from the LLM API after the most recent request.
   * `undefined` until the first `updateUsage()` call.
   *
   * Contrast with *estimated* counts used by `shouldPrune` / `shouldCompact`
   * (chars÷4 heuristic, computed before the API call).
   */
  get lastUsage(): { inputTokens: number; outputTokens: number } | undefined {
    return this._lastUsage;
  }

  /**
   * Check whether the context is large enough to trigger **truncation**.
   *
   * Uses an *estimated* token count (chars÷4 heuristic) because this check
   * runs BEFORE the LLM API call and actual counts are not yet available.
   */
  shouldPrune(messages: Array<Message>): boolean {
    const estimated = estimateMessageTokens(messages);
    const threshold = this.config.pruneThreshold ?? DEFAULTS.contextWindow.pruneThreshold;
    return estimated > (this.config.maxContextTokens ?? 0) * threshold;
  }

  /**
   * Check whether the context is large enough to trigger **summarization**.
   *
   * Uses an *estimated* token count (chars÷4 heuristic) because this check
   * runs BEFORE the LLM API call and actual counts are not yet available.
   */
  shouldCompact(messages: Array<Message>): boolean {
    const estimated = estimateMessageTokens(messages);
    const threshold = this.config.compactionThreshold ?? DEFAULTS.contextWindow.compactionThreshold;
    return estimated > (this.config.maxContextTokens ?? 0) * threshold;
  }

  /**
   * Record actual token usage reported by the LLM API after a request.
   *
   * This is post-request *actual* usage, not the pre-request *estimate*.
   * The value is surfaced via `lastUsage` for monitoring / metrics.
   */
  updateUsage(usage: { inputTokens: number; outputTokens: number }): void {
    this._lastUsage = usage;
  }

  /**
   * **Truncation strategy** — replace old tool-result content with "[pruned]".
   *
   * Delegates to `pruneMessages()` in `prune.ts`.  Message structure is
   * preserved (no messages dropped) so the API never sees orphaned tool_use.
   *
   * `tokensSaved` is an *estimate* (chars÷4), not actual API-reported usage.
   */
  prune(messages: Array<Message>): PruneResult {
    return pruneMessages(messages, DEFAULTS.contextWindow.protectedRecentPairs);
  }

  /**
   * **Summarization strategy** — call an LLM to condense conversation history.
   *
   * Delegates to `strategy.compact()` (see `compaction.ts`).  Falls back to
   * keeping the system prompt + N most-recent messages on failure.
   *
   * `tokensSaved` is an *estimate* (chars÷4 on before/after message arrays).
   */
  async compact(
    messages: Array<Message>,
    provider: LLMProvider,
    strategy: CompactionStrategy
  ): Promise<{ compacted: Array<Message>; originalCount: number; tokensSaved: number }> {
    const originalTokens = estimateMessageTokens(messages);

    try {
      const compacted = await strategy.compact(messages, provider);
      const compactedTokens = estimateMessageTokens(compacted);
      telemetryLog(
        `context_compaction_success: original=${messages.length} compacted=${compacted.length} tokens_saved=${originalTokens - compactedTokens}`
      );
      return {
        compacted,
        originalCount: messages.length,
        tokensSaved: originalTokens - compactedTokens,
      };
    } catch (error: unknown) {
      this.logger?.warn(`[ContextWindow] Compaction failed, using fallback: ${formatError(error)}`);
      const fallback = [messages[0], ...messages.slice(-DEFAULTS.compaction.recentMessagesBuffer)];
      const fallbackTokens = estimateMessageTokens(fallback);
      return {
        compacted: fallback,
        originalCount: messages.length,
        tokensSaved: originalTokens - fallbackTokens,
      };
    }
  }
}
