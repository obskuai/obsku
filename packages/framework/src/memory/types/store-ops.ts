import type { Entity, Fact } from "./entities";

/**
 * Options for listing entities from the memory store.
 */
export interface ListEntitiesOptions {
  /** Maximum number of entities to return */
  limit?: number;
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by entity type */
  type?: string;
  /** Filter by workspace ID */
  workspaceId?: string;
}

/**
 * Options for listing facts from the memory store.
 */
export interface ListFactsOptions {
  /** Maximum number of facts to return */
  limit?: number;
  /** Minimum confidence threshold (0.0 - 1.0) */
  minConfidence?: number;
  /** Filter by workspace ID */
  workspaceId?: string;
}

/**
 * Options for semantic search operations.
 */
export interface SemanticSearchOptions {
  /** Filter by session ID */
  sessionId?: string;
  /** Minimum similarity threshold (default: 0.0, range: -1 to 1) */
  threshold?: number;
  /** Maximum number of results to return (default: 10) */
  topK?: number;
  /** Filter by workspace ID */
  workspaceId?: string;
}

/**
 * Memory store interface for Entity and Fact operations.
 * This is the base interface; implementations in checkpoint packages
 * will extend CheckpointStore AND implement this interface.
 */
export interface MemoryStoreOperations {
  /** Flag indicating whether this store supports semantic search */
  readonly hasSemanticSearch: boolean;

  /**
   * Delete an entity.
   * @param id - Entity ID to delete
   */
  deleteEntity(id: string): Promise<void>;

  /**
   * Delete a fact.
   * @param id - Fact ID to delete
   */
  deleteFact(id: string): Promise<void>;

  /**
   * Retrieve an entity by ID.
   * @param id - Entity ID
   * @returns The entity or null if not found
   */
  getEntity(id: string): Promise<Entity | null>;

  /**
   * Retrieve a fact by ID.
   * @param id - Fact ID
   * @returns The fact or null if not found
   */
  getFact(id: string): Promise<Fact | null>;

  /**
   * List entities with optional filters.
   * @param options - Filter and pagination options
   * @returns Array of matching entities
   */
  listEntities(options: ListEntitiesOptions): Promise<Array<Entity>>;

  /**
   * List facts with optional filters.
   * @param options - Filter and pagination options
   * @returns Array of matching facts
   */
  listFacts(options: ListFactsOptions): Promise<Array<Fact>>;

  /**
   * Save a new entity to the store.
   * @param entity - Entity data (id, createdAt, updatedAt auto-generated)
   * @returns The created entity with generated fields
   */
  saveEntity(entity: Omit<Entity, "id" | "createdAt" | "updatedAt">): Promise<Entity>;

  /**
   * Save a new fact to the store.
   * @param fact - Fact data (id, createdAt auto-generated)
   * @returns The created fact with generated fields
   */
  saveFact(fact: Omit<Fact, "id" | "createdAt">): Promise<Fact>;

  /**
   * Search entities by semantic similarity using vector embeddings.
   * @param embedding - Query embedding vector
   * @param options - Search options including topK, threshold, sessionId, workspaceId
   * @returns Array of entities sorted by similarity (highest first)
   */
  searchEntitiesSemantic(
    embedding: Array<number>,
    options?: SemanticSearchOptions
  ): Promise<Array<Entity>>;

  /**
   * Search facts by semantic similarity using vector embeddings.
   * @param embedding - Query embedding vector
   * @param options - Search options including topK, threshold, sessionId, workspaceId
   * @returns Array of facts sorted by similarity (highest first)
   */
  searchFactsSemantic(
    embedding: Array<number>,
    options?: SemanticSearchOptions
  ): Promise<Array<Fact>>;

  /**
   * Update an existing entity.
   * @param id - Entity ID to update
   * @param updates - Partial entity updates
   */
  updateEntity(id: string, updates: Partial<Entity>): Promise<void>;
}
