import { z } from "zod";
import { getErrorMessage } from "../error-utils";

export class VectorDimensionError extends Error {
  readonly _tag = "VectorDimensionError" as const;
  constructor(
    readonly dimensionA: number,
    readonly dimensionB: number
  ) {
    super(`Vector dimensions must match: ${dimensionA} vs ${dimensionB}`);
    this.name = "VectorDimensionError";
  }
}

export class EmbeddingDeserializationError extends Error {
  readonly _tag = "EmbeddingDeserializationError" as const;
  constructor(
    readonly reason: string,
    readonly originalError: unknown
  ) {
    super(`Failed to deserialize embedding: ${reason}`, { cause: originalError });
    this.name = "EmbeddingDeserializationError";
  }
}

function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  );
}

function isSyntaxError(error: unknown): error is SyntaxError {
  return error?.constructor === SyntaxError;
}

function isZodError(error: unknown): error is z.ZodError {
  return (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray((error as { issues?: unknown }).issues) &&
    "name" in error &&
    error.name === "ZodError"
  );
}

/**
 * Calculate cosine similarity between two vectors.
 * Returns value between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
 */
export function cosineSimilarity(a: Array<number>, b: Array<number>): number {
  if (a.length !== b.length) {
    throw new VectorDimensionError(a.length, b.length);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

/**
 * Deserialize embedding from various storage formats.
 * Handles BLOB/Uint8Array (from SQLite) or string (JSON text).
 * Throws EmbeddingDeserializationError on invalid input.
 */
export function deserializeEmbedding(
  embedding: Uint8Array | Buffer | string | null
): Array<number> | null {
  if (!embedding) {
    return null;
  }

  // Empty string, empty Uint8Array, or empty Buffer should return null
  if (typeof embedding === "string" && embedding.length === 0) {
    return null;
  }

  if (typeof embedding !== "string" && embedding.length === 0) {
    return null;
  }

  try {
    // If it's already a string, parse it directly
    if (typeof embedding === "string") {
      const parsed = JSON.parse(embedding);
      return z.array(z.number()).parse(parsed);
    }

    // If it's a Uint8Array or Buffer, decode it first
    const textDecoder = new TextDecoder("utf-8");
    const jsonString = textDecoder.decode(embedding);
    const parsed = JSON.parse(jsonString);
    return z.array(z.number()).parse(parsed);
  } catch (error: unknown) {
    const reason =
      isSyntaxError(error) && isErrorWithMessage(error)
        ? `Invalid JSON: ${error.message}`
        : isZodError(error) && isErrorWithMessage(error)
          ? `Invalid numeric array: ${error.message}`
          : `Unknown error: ${getErrorMessage(error)}`;
    throw new EmbeddingDeserializationError(reason, error);
  }
}

/**
 * Serialize embedding to JSON string for storage.
 */
export function serializeEmbedding(embedding: Array<number> | null): string | null {
  if (!embedding) {
    return null;
  }
  return JSON.stringify(embedding);
}

/**
 * Ranking policy: filter scored items by threshold, sort descending, take topK.
 *
 * This is the canonical ranking policy for semantic search. Both in-memory
 * (semanticSearchGeneric) and SQL (scoreAndRank) apply this same policy:
 *   1. Discard items with similarity < threshold
 *   2. Sort remaining items by similarity descending
 *   3. Return the first topK items
 *
 * semanticSearchGeneric applies the same policy but uses a min-heap during
 * iteration (O(K log K) amortized) to avoid a full O(N log N) sort over the
 * entire collection. rankScoredItems uses a simple sort, appropriate when N
 * is already bounded (e.g. SQL pre-filtered result set).
 */
export function rankScoredItems<T>(
  scoredItems: Array<{ item: T; similarity: number }>,
  threshold: number,
  topK: number
): Array<T> {
  return scoredItems
    .filter((s) => s.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
    .map((s) => s.item);
}
