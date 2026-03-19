import type { Entity, Fact } from "./entities";

/**
 * Data to inject into the agent's context from memory.
 */
export interface MemoryInjection {
  /** Additional context to add to system prompt */
  context?: string;
  /** Entities loaded for reference */
  entities?: Array<Entity>;
  /** Facts loaded for reference */
  facts?: Array<Fact>;
}
