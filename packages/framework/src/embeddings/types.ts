// =============================================================================
// @obsku/framework — embedding types
// =============================================================================

/**
 * Interface for embedding providers.
 * Implement this to add support for OpenAI, Cohere, or custom embedding services.
 */
export interface EmbeddingProvider {
  /**
   * Dimension of the embedding vectors.
   * e.g., 1536 for OpenAI text-embedding-3-small, 768 for Cohere embed-english-v3
   */
  readonly dimension: number;

  /**
   * Generate embedding for a single text.
   * @param text - The text to embed
   * @returns Promise resolving to embedding vector
   */
  embed(text: string): Promise<Array<number>>;

  /**
   * Generate embeddings for multiple texts in batch.
   * More efficient than calling embed() multiple times.
   * @param texts - Array of texts to embed
   * @returns Promise resolving to array of embedding vectors
   */
  embedBatch(texts: Array<string>): Promise<Array<Array<number>>>;

  /**
   * Name of the embedding model being used.
   * e.g., "text-embedding-3-small", "embed-english-v3"
   */
  readonly modelName: string;
}

/**
 * Configuration for creating an embedding provider.
 */
export interface EmbeddingConfig {
  /** Additional provider-specific options */
  [key: string]: unknown;

  /** API key for the provider */
  apiKey?: string;

  /** Base URL for API requests (for custom endpoints or proxies) */
  baseURL?: string;

  /** Model name/identifier */
  model?: string;

  /** Provider identifier: "openai", "cohere", "bedrock", etc. */
  provider: string;
}

/**
 * Options for embedding operations.
 */
export interface EmbedOptions {
  /** Optional signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Result of an embedding operation.
 */
export interface EmbedResult {
  /** The embedding vector */
  embedding: Array<number>;

  /** Token count used (if available) */
  tokenCount?: number;
}

/**
 * Result of a batch embedding operation.
 */
export interface EmbedBatchResult {
  /** Array of embedding vectors */
  embeddings: Array<Array<number>>;

  /** Total token count used (if available) */
  tokenCount?: number;
}
