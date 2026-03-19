/**
 * Represents a relationship between two entities.
 * Used to model connections like "owns", "manages", "resolves_to", etc.
 */
export interface Relationship {
  /** Target entity ID */
  targetId: string;
  /** Relationship type (e.g., "owns", "manages", "resolves_to") */
  type: string;
}

/**
 * An entity extracted from conversation context.
 * Entities represent discrete objects or concepts tracked across sessions.
 */
export interface Entity {
  /** Flexible key-value attributes */
  attributes: Record<string, unknown>;
  /** Unix timestamp (ms) when entity was created */
  createdAt: number;
  /** Optional vector embedding for semantic search */
  embedding?: Array<number>;
  /** Unique identifier for the entity */
  id: string;
  /** Entity name (e.g., "John Doe", "example.com") */
  name: string;
  /** Relationships to other entities */
  relationships: Array<Relationship>;
  /** Session where entity was first discovered */
  sessionId: string;
  /** User-defined entity type (e.g., "person", "domain", "ip") */
  type: string;
  /** Unix timestamp (ms) when entity was last updated */
  updatedAt: number;
  /** Optional workspace for cross-session entity linking */
  workspaceId?: string;
}

/**
 * A fact learned from conversation that persists across sessions.
 * Facts represent knowledge about the workspace or domain.
 */
export interface Fact {
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** The fact content (natural language statement) */
  content: string;
  /** Unix timestamp (ms) when fact was created */
  createdAt: number;
  /** Optional vector embedding for semantic search */
  embedding?: Array<number>;
  /** Unique identifier for the fact */
  id: string;
  /** Session where this fact was learned */
  sourceSessionId?: string;
  /** Optional workspace scope for the fact */
  workspaceId?: string;
}
