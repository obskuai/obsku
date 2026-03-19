import type { LLMResponse } from "../../types/llm";
import type { Entity } from "./entities";
import type { MemoryHookContext } from "./hook-context";
import type { MemoryInjection } from "./payloads";

/**
 * Memory hooks for customizing memory behavior.
 * All hooks have default implementations that can be overridden.
 */
export interface MemoryHooks {
  /**
   * Called after each LLM response. Extract entities from the response.
   * Default: Use extractionProvider to identify entities
   * @param ctx - Memory hook context with LLM response
   * @returns Array of extracted entities
   */
  onEntityExtract?: (ctx: MemoryHookContext & { response: LLMResponse }) => Promise<Array<Entity>>;

  /**
   * Called at agent start. Load and return context to inject.
   * Default: Load recent entities + high-confidence facts
   * @param ctx - Memory hook context
   * @returns Memory injection to add to prompt
   */
  onMemoryLoad?: (ctx: MemoryHookContext) => Promise<MemoryInjection>;

  /**
   * Called at agent end. Save long-term memory.
   * Default: Use extractionProvider to summarize and extract facts
   * @param ctx - Memory hook context
   */
  onMemorySave?: (ctx: MemoryHookContext) => Promise<void>;
}
