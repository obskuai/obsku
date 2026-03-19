// =============================================================================
// @obsku/framework — Context Window Configuration type definitions
// =============================================================================

import type { CompactionStrategy } from "./compaction";
import type { LLMProvider } from "./providers";

/**
 * Configuration for agent context window management.
 * Controls pruning, compaction, and token limits.
 */
export interface ContextWindowConfig {
  /** LLM provider for compaction. Default: uses agent's provider */
  compactionProvider?: LLMProvider;
  /** Custom compaction strategy. Default: built-in summarization */
  compactionStrategy?: CompactionStrategy;
  /** Threshold (0-1) of maxContextTokens to trigger compaction. Default: 0.85 */
  compactionThreshold?: number;
  /** Enable context window management. Defaults to true if maxContextTokens is set, false otherwise. */
  enabled?: boolean;
  /** Maximum tokens for context window. Optional — falls back to provider.contextWindowSize */
  maxContextTokens?: number;
  /** Threshold (0-1) of maxContextTokens to trigger pruning. Default: 0.7 */
  pruneThreshold?: number;
  /** Tokens to reserve for output. Default: 4096 */
  reserveOutputTokens?: number;
}
