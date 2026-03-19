// =============================================================================
// @obsku/framework — Graph traversal helpers
// =============================================================================

import type { GraphEdge } from "./types";

export function buildReverseAdjacency(
  nodeIds: Iterable<string>,
  edges: ReadonlyArray<GraphEdge>
): Map<string, Array<string>> {
  const reverseAdjacency = new Map<string, Array<string>>();
  for (const id of nodeIds) {
    reverseAdjacency.set(id, []);
  }
  for (const edge of edges) {
    reverseAdjacency.get(edge.to)?.push(edge.from);
  }
  return reverseAdjacency;
}

export function collectReachable(
  start: string,
  adjacency: ReadonlyMap<string, ReadonlyArray<GraphEdge>> | Map<string, ReadonlyArray<GraphEdge>>
): Set<string> {
  const visited = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      queue.push(edge.to);
    }
  }
  return visited;
}

export function collectReverseReachable(
  start: string,
  reverseAdjacency: ReadonlyMap<string, ReadonlyArray<string>>
): Set<string> {
  const visited = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const parent of reverseAdjacency.get(current) ?? []) {
      queue.push(parent);
    }
  }
  return visited;
}
