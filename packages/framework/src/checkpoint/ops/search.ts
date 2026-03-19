import type { Entity, Fact, Relationship, SemanticSearchOptions } from "../../memory/index";
import { cosineSimilarity } from "../similarity";

const DEFAULT_SEARCH_THRESHOLD = 0;

function heapParent(i: number): number {
  return (i - 1) >> 1;
}

function heapLeft(i: number): number {
  return (i << 1) + 1;
}

function heapRight(i: number): number {
  return (i << 1) + 2;
}

/**
 * Applies the same ranking policy as rankScoredItems (see similarity.ts):
 *   1. Filter items by threshold (skip if similarity < threshold)
 *   2. Keep only topK highest-similarity results
 *   3. Return results sorted descending by similarity
 *
 * Implementation uses a min-heap to avoid an O(N log N) sort over the full
 * collection. The heap maintains exactly topK entries during traversal, so
 * the final sort is O(K log K) where K = topK, not O(N log N).
 * scoreAndRank (sql-search-ops.ts) uses rankScoredItems directly because
 * its input N is already bounded by SQL pre-filtering.
 */
function semanticSearchGeneric<T>(
  collection: Map<string, T>,
  embedding: Array<number>,
  options: SemanticSearchOptions,
  getEmbedding: (item: T) => number[] | undefined,
  scopeFilters: Array<(item: T) => boolean>
): Array<T> {
  const { threshold = DEFAULT_SEARCH_THRESHOLD, topK = 10 } = options;

  // Use a min-heap approach to avoid full sort
  // Maintains topK highest scores without sorting entire collection
  type ScoredItem = { item: T; similarity: number };
  const heap: Array<ScoredItem> = [];

  for (const item of collection.values()) {
    // Apply scope filters first (cheap check)
    let passesFilters = true;
    for (const filter of scopeFilters) {
      if (!filter(item)) {
        passesFilters = false;
        break;
      }
    }
    if (!passesFilters) {
      continue;
    }

    const emb = getEmbedding(item);
    if (!emb || emb.length === 0) {
      continue;
    }

    const similarity = cosineSimilarity(embedding, emb);
    if (similarity < threshold) {
      continue;
    }

    // Min-heap insertion: maintain topK highest scores
    if (heap.length < topK) {
      heap.push({ item, similarity });
      // Bubble up to maintain min-heap property
      let currentIndex = heap.length - 1;
      while (currentIndex > 0) {
        const parent = heapParent(currentIndex);
        if (heap[parent].similarity <= heap[currentIndex].similarity) {
          break;
        }
        [heap[parent], heap[currentIndex]] = [heap[currentIndex], heap[parent]];
        currentIndex = parent;
      }
    } else if (similarity > heap[0].similarity) {
      // Replace minimum and heapify down
      heap[0] = { item, similarity };
      let currentIndex = 0;
      while (true) {
        const left = heapLeft(currentIndex);
        const right = heapRight(currentIndex);
        let smallest = currentIndex;
        if (left < heap.length && heap[left].similarity < heap[smallest].similarity) {
          smallest = left;
        }
        if (right < heap.length && heap[right].similarity < heap[smallest].similarity) {
          smallest = right;
        }
        if (smallest === currentIndex) {
          break;
        }
        [heap[currentIndex], heap[smallest]] = [heap[smallest], heap[currentIndex]];
        currentIndex = smallest;
      }
    }
  }

  // Sort heap by similarity descending (required for consistent output)
  // This is O(K log K) where K = topK, not O(N log N)
  heap.sort((a, b) => b.similarity - a.similarity);

  return heap.map((s) => s.item);
}

export function searchEntitiesSemantic(
  entities: Map<string, Entity>,
  embedding: Array<number>,
  options: SemanticSearchOptions = {}
): Array<Entity> {
  const results = semanticSearchGeneric(entities, embedding, options, (e) => e.embedding, [
    (e) => !options.sessionId || e.sessionId === options.sessionId,
    (e) => !options.workspaceId || e.workspaceId === options.workspaceId,
  ]);
  return results.map((e) => ({
    ...e,
    attributes: { ...e.attributes },
    relationships: e.relationships.map((r: Relationship) => ({ ...r })),
    ...(e.embedding && { embedding: [...e.embedding] }),
  }));
}

export function searchFactsSemantic(
  facts: Map<string, Fact>,
  embedding: Array<number>,
  options: SemanticSearchOptions = {}
): Array<Fact> {
  const results = semanticSearchGeneric(facts, embedding, options, (f) => f.embedding, [
    (f) => !options.workspaceId || f.workspaceId === options.workspaceId,
  ]);
  return results.map((f) => ({
    ...f,
    ...(f.embedding && { embedding: [...f.embedding] }),
  }));
}
