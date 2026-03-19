// =============================================================================
// @obsku/framework — Memory Configuration type definitions
// =============================================================================

import type { EmbeddingProvider } from "../embeddings/types";
import type { MemoryHooks, MemoryStoreOperations } from "../memory/types";
import type { LLMProvider } from "./providers";

/**
 * Configuration for agent memory system (entity memory, long-term facts).
 */
export interface MemoryConfig {
  /** Enable memory context injection into prompts. Default: true when enabled */
  contextInjection?: boolean;
  /** Embedding provider for semantic search. Optional - enables semantic memory features */
  embeddingProvider?: EmbeddingProvider;
  /** Master switch. Default: false */
  enabled?: boolean;
  /** Enable entity memory extraction. Default: true when enabled */
  entityMemory?: boolean;
  /** Custom error handler */
  errorHandler?: (error: Error, hookName: string) => void;
  /** LLM provider for extraction. Default: uses agent's provider */
  extractionProvider?: LLMProvider;
  /** Custom hooks to override defaults */
  hooks?: Partial<MemoryHooks>;
  /** Enable long-term fact memory. Default: true when enabled */
  longTermMemory?: boolean;
  /** Max context length (chars). Default: 2000 */
  maxContextLength?: number;
  /** Max entities per session. Default: 100 */
  maxEntitiesPerSession?: number;
  /** Max facts to inject. Default: 10 */
  maxFactsToInject?: number;
  /** Error policy for hooks. Default: 'log' */
  onHookError?: "throw" | "log" | "ignore";
  /** Memory store for entity/fact persistence */
  store?: MemoryStoreOperations;
}
