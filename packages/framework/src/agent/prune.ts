// =============================================================================
// @obsku/framework — Truncation (prune) strategy helpers
// =============================================================================
//
// This module contains the *truncation* half of context-window management.
// Truncation replaces old tool-result content with "[pruned]" in-place so the
// conversation structure stays valid for the LLM API.
//
// Contrast with the *summarization* strategy in compaction.ts, which calls an
// LLM to produce a shorter narrative summary of the conversation.
//
// TOKEN ESTIMATION NOTE:
//   All token counts in this module are *estimates* produced by the
//   `estimateTokens` / `estimateMessageTokens` helpers (chars ÷ 4 heuristic).
//   They are intentionally cheap to compute and are used for pre-request
//   gating decisions.  Actual token counts (as reported by the LLM API) are
//   tracked separately via `ContextWindowManager.updateUsage()` and
//   `ContextWindowManager.lastUsage` — those values are available *after* the
//   API call and are NOT used here.
// =============================================================================

import { BlockType, MessageRole } from "../types/constants";
import type { ContentBlock, Message } from "../types/llm";
import { estimateTokens } from "./token-estimation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCallPair {
  /** Index of the message that contains the matching tool_result block */
  toolResultMsgIdx: number;
  /** Shared identifier linking tool_use ↔ tool_result */
  toolUseId: string;
  /** Index of the message that contains the matching tool_use block */
  toolUseMsgIdx: number;
}

export interface PruneResult {
  /** Message array after truncation (original array is NOT mutated) */
  pruned: Array<Message>;
  /** Number of tool_result blocks that were replaced with "[pruned]" */
  removed: number;
  /** Estimated token delta (estimated tokens freed) */
  tokensSaved: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find all tool_use / tool_result pairs in a message array.
 *
 * A "pair" is a `tool_use` block in one message and the corresponding
 * `tool_result` block (same `toolUseId`) in another message.  Unpaired
 * blocks (half-orphans) are silently ignored — they will not be pruned.
 */
export function findToolCallPairs(messages: Array<Message>): Array<ToolCallPair> {
  // Pass 1: record which message index contains each tool_use id.
  const toolUseMap = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    for (const block of messages[i].content) {
      if (block.type === BlockType.TOOL_USE) {
        toolUseMap.set(block.toolUseId, i);
      }
    }
  }

  // Pass 2: match tool_result blocks to their tool_use partner.
  const pairs: Array<ToolCallPair> = [];
  for (let i = 0; i < messages.length; i++) {
    for (const block of messages[i].content) {
      if (block.type === BlockType.TOOL_RESULT) {
        const toolUseMsgIdx = toolUseMap.get(block.toolUseId);
        if (toolUseMsgIdx !== undefined) {
          pairs.push({ toolResultMsgIdx: i, toolUseId: block.toolUseId, toolUseMsgIdx });
        }
      }
    }
  }

  return pairs;
}

/**
 * Return the index of the last message whose role is `user`, or -1 if none.
 *
 * Used to protect the most-recent user message from being pruned so that the
 * next LLM request always has the current question in scope.
 */
export function findLastUserIndex(messages: Array<Message>): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === MessageRole.USER) {
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Core truncation logic
// ---------------------------------------------------------------------------

/**
 * Truncate old tool-result content to free estimated token budget.
 *
 * **Strategy (truncation, not summarization):**
 * 1. Find all tool_use / tool_result pairs.
 * 2. Protect the `protectedRecentPairs` newest pairs from being pruned.
 * 3. Skip the first message (system prompt) and the last user message.
 * 4. Replace qualifying tool_result `.content` with the literal string
 *    `"[pruned]"` — the message/block structure is preserved so the API
 *    never sees an orphaned tool_use.
 *
 * **Token estimation (not actual usage):**
 * `tokensSaved` is computed with the chars÷4 heuristic from
 * `token-estimation.ts`.  It is a *rough estimate*, not the actual saving
 * as reported by the LLM API.  Use `ContextWindowManager.lastUsage` if you
 * need API-reported counts.
 *
 * @param messages - Input message array (not mutated).
 * @param protectedRecentPairs - How many recent pairs to leave untouched.
 * @returns `{ pruned, removed, tokensSaved }`.
 */
export function pruneMessages(messages: Array<Message>, protectedRecentPairs: number): PruneResult {
  if (messages.length === 0) {
    return { pruned: [], removed: 0, tokensSaved: 0 };
  }

  const toolPairs = findToolCallPairs(messages);

  if (toolPairs.length === 0) {
    return { pruned: messages, removed: 0, tokensSaved: 0 };
  }

  const protectedCount = Math.min(protectedRecentPairs, Math.max(0, toolPairs.length - 1));
  const prunablePairs = toolPairs.slice(0, toolPairs.length - protectedCount);

  if (prunablePairs.length === 0) {
    return { pruned: messages, removed: 0, tokensSaved: 0 };
  }

  const lastUserIdx = findLastUserIndex(messages);

  // Collect tool-use IDs that are safe to prune.
  const prunableToolResultIds = new Set<string>();
  for (const pair of prunablePairs) {
    // Skip pairs that touch the system prompt (index 0) or last user message.
    if (pair.toolResultMsgIdx === 0 || pair.toolResultMsgIdx === lastUserIdx) {
      continue;
    }
    if (pair.toolUseMsgIdx === 0 || pair.toolUseMsgIdx === lastUserIdx) {
      continue;
    }
    prunableToolResultIds.add(pair.toolUseId);
  }

  if (prunableToolResultIds.size === 0) {
    return { pruned: messages, removed: 0, tokensSaved: 0 };
  }

  let removed = 0;
  // tokensSaved is an *estimate* (chars÷4), not actual API token usage.
  let tokensSaved = 0;

  const pruned: Array<Message> = messages.map((msg) => {
    const newContent: Array<ContentBlock> = msg.content.map((block) => {
      if (block.type === BlockType.TOOL_RESULT && prunableToolResultIds.has(block.toolUseId)) {
        const oldTokens = estimateTokens(block.content);
        const newTokens = estimateTokens("[pruned]");
        tokensSaved += oldTokens - newTokens;
        removed++;
        return { ...block, content: "[pruned]" };
      }
      return block;
    });
    return { ...msg, content: newContent };
  });

  return { pruned, removed, tokensSaved };
}
