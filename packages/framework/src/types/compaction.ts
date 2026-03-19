// =============================================================================
// @obsku/framework — Context compaction type definitions
// =============================================================================

import type { Message } from "./llm";
import type { LLMProvider } from "./providers";

/**
 * Strategy for compacting context window messages.
 * Implementations can summarize, compress, or filter messages.
 */
export interface CompactionStrategy {
  /**
   * Compact messages to reduce token count.
   * @param messages - Current message history
   * @param provider - LLM provider for summarization/compression
   * @returns Promise resolving to compacted message array
   */
  compact(messages: Array<Message>, provider: LLMProvider): Promise<Array<Message>>;
}
