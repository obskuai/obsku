// =============================================================================
// @obsku/framework — Topological sort with parallel wave detection
// =============================================================================

import { GraphCycleError } from "./errors";
import type { ToposortInput } from "./types";

/**
 * Topological sort returning execution waves.
 * Each wave contains node IDs that can execute in parallel (no dependencies within wave).
 *
 * Uses Kahn's algorithm:
 * 1. Calculate in-degree for each node
 * 2. Wave 0: nodes with in-degree 0
 * 3. Remove wave nodes, decrement neighbors' in-degree
 * 4. Repeat until all nodes processed
 *
 * @example
 * Linear A→B→C: [["A"], ["B"], ["C"]]
 * Diamond A→(B,C)→D: [["A"], ["B", "C"], ["D"]]
 */
export function toposort(graph: ToposortInput): Array<Array<string>> {
  const { edges, nodes } = graph;

  // Compute in-degrees
  const inDegree = new Map<string, number>();
  for (const id of nodes.keys()) {
    inDegree.set(id, 0);
  }
  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const waves: Array<Array<string>> = [];
  const remaining = new Set(inDegree.keys());

  while (remaining.size > 0) {
    // Find all nodes with in-degree 0 (ready to execute)
    const wave: Array<string> = [];
    for (const id of remaining) {
      if (inDegree.get(id) === 0) {
        wave.push(id);
      }
    }

    if (wave.length === 0) {
      // Cycle detected - remaining nodes are in cycle
      const cycleNodes = [...remaining];
      throw new GraphCycleError(cycleNodes);
    }

    // Remove wave nodes from remaining
    for (const id of wave) {
      remaining.delete(id);
    }

    // Decrement in-degree of neighbors (O(n) total via Set)
    const waveSet = new Set(wave);
    for (const edge of edges) {
      if (waveSet.has(edge.from)) {
        const newDeg = (inDegree.get(edge.to) ?? 1) - 1;
        inDegree.set(edge.to, newDeg);
      }
    }

    waves.push(wave);
  }

  return waves;
}
