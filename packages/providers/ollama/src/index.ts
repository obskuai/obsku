import { getErrorMessage } from "@obsku/framework";
import type { EmbeddingProvider } from "@obsku/framework";
import { Ollama } from "ollama";

export interface OllamaEmbeddingConfig {
  /** Embedding dimension for the chosen model */
  dimension: number;
  /** Ollama host URL (default: http://localhost:11434) */
  host?: string;
  /** Ollama embedding model name */
  model: string;
}

const DEFAULT_HOST = "http://localhost:11434";

export class OllamaEmbedding implements EmbeddingProvider {
  private client: Ollama;
  readonly modelName: string;
  readonly dimension: number;

  constructor(config: OllamaEmbeddingConfig) {
    this.modelName = config.model;
    this.dimension = config.dimension;
    const host = config.host ?? DEFAULT_HOST;
    this.client = new Ollama({ host });
  }

  async embed(text: string): Promise<Array<number>> {
    try {
      const response = await this.client.embeddings({
        model: this.modelName,
        prompt: text,
      });
      return response.embedding;
    } catch (error: unknown) {
      throw new OllamaEmbeddingError(`Failed to generate embedding: ${getErrorMessage(error)}`);
    }
  }

  async embedBatch(texts: Array<string>): Promise<Array<Array<number>>> {
    // Ollama doesn't have a native batch API, so we parallelize individual calls
    try {
      return await parallelizeEmbeds(texts, (text) => this.embed(text));
    } catch (error: unknown) {
      if (error instanceof OllamaEmbeddingError) {
        throw error;
      }
      throw new OllamaEmbeddingError(
        `Failed to generate batch embeddings: ${getErrorMessage(error)}`
      );
    }
  }
}

export class OllamaEmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaEmbeddingError";
  }
}

/**
 * Parallelize embedding calls for providers without native batch API.
 * @internal
 */
function parallelizeEmbeds<T>(
  texts: Array<string>,
  embedFn: (text: string) => Promise<T>
): Promise<Array<T>> {
  return Promise.all(texts.map(embedFn));
}
