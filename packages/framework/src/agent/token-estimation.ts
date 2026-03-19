import type { ContentBlock, Message } from "../types/llm";
import { debugLog } from "../telemetry/log";

/**
 * Characters per token heuristic (OpenCode pattern).
 * Average of 4 characters per token for rough estimation.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count from text string using chars/4 heuristic.
 * @param text - The text to estimate tokens for
 * @returns Estimated token count (rounded, minimum 0)
 */
export function estimateTokens(text: string): number {
  return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN));
}

/**
 * Estimate total token count from an array of messages.
 * Handles TextContent, ToolUseContent, and ToolResultContent blocks.
 * @param messages - Array of messages to estimate tokens for
 * @returns Total estimated token count
 */
export function estimateMessageTokens(messages: Array<Message>): number {
  let totalTokens = 0;

  for (const message of messages) {
    for (const block of message.content) {
      totalTokens += estimateContentBlockTokens(block);
    }
  }

  return totalTokens;
}

/**
 * Estimate tokens for a single content block.
 * @param block - The content block to estimate tokens for
 * @returns Estimated token count for this block
 */
function estimateContentBlockTokens(block: ContentBlock): number {
  switch (block.type) {
    case "text":
      return estimateTokens(block.text);
    case "tool_use":
      return estimateTokens(JSON.stringify(block.input));
    case "tool_result":
      return estimateTokens(block.content);
    default:
      debugLog(`unknown_content_block_type: type=${(block as { type: string }).type}`);
      return 0;
  }
}
