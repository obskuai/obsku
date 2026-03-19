// =============================================================================
// @obsku/framework — Graph builder with validation
// =============================================================================

import { createTaggedError } from "../errors/tagged-error";
import { GraphCycleError } from "./errors";
import { toposort } from "./toposort";
import type { Graph, GraphEdge, GraphInput, GraphNode } from "./types";
import { DEFAULT_GRAPH_CONFIG } from "./types";

// --- Validation Errors ---

export const GraphValidationError = createTaggedError("GraphValidationError");
export type GraphValidationError = InstanceType<typeof GraphValidationError>;

// --- Validation helpers ---

function validateEdgeReferences(
  nodes: ReadonlyMap<string, GraphNode>,
  edges: ReadonlyArray<GraphEdge>
): void {
  for (const edge of edges) {
    if (!nodes.has(edge.from)) {
      throw new GraphValidationError(`Edge references nonexistent source node: "${edge.from}"`);
    }
    if (!nodes.has(edge.to)) {
      throw new GraphValidationError(`Edge references nonexistent target node: "${edge.to}"`);
    }
  }
}

function validateNoSelfEdges(edges: ReadonlyArray<GraphEdge>): void {
  for (const edge of edges) {
    if (edge.from === edge.to) {
      throw new GraphValidationError(
        `Self-edge detected: node "${edge.from}" cannot connect to itself`
      );
    }
  }
}

function validateBackEdges(edges: ReadonlyArray<GraphEdge>): void {
  for (const edge of edges) {
    if (!edge.back) {
      continue;
    }
    if (!edge.maxIterations || edge.maxIterations <= 0) {
      throw new GraphValidationError(
        `Back-edge from "${edge.from}" to "${edge.to}" requires maxIterations > 0`
      );
    }
  }
}

function validateEntryExists(nodes: ReadonlyMap<string, GraphNode>, entry: string): void {
  if (!nodes.has(entry)) {
    throw new GraphValidationError(`Entry node "${entry}" not found in node list`);
  }
}

/**
 * Check all nodes are reachable from entry via BFS on the undirected graph.
 * "Orphan" = not reachable from entry.
 */
function validateNoOrphans(
  nodes: ReadonlyMap<string, GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  entry: string
): void {
  // Build undirected adjacency
  const adj = new Map<string, Set<string>>();
  for (const id of nodes.keys()) {
    adj.set(id, new Set());
  }
  for (const edge of edges) {
    adj.get(edge.from)?.add(edge.to);
    adj.get(edge.to)?.add(edge.from);
  }

  // BFS from entry
  const visited = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const neighbor of adj.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  // Check all nodes visited
  for (const id of nodes.keys()) {
    if (!visited.has(id)) {
      throw new GraphValidationError(
        `Orphan node detected: "${id}" is not reachable from entry "${entry}"`
      );
    }
  }
}

/**
 * Topological sort using canonical toposort function.
 * Flattens waves into execution order.
 * Cycle detection is handled by toposort().
 */
function topologicalSort(
  nodes: ReadonlyMap<string, GraphNode>,
  edges: ReadonlyArray<GraphEdge>
): ReadonlyArray<string> {
  const tempGraph = {
    // Safe: temp graph for toposort validation only, provider never accessed
    edges,
    nodes,
  };

  try {
    const waves = toposort(tempGraph);
    return waves.flat();
  } catch (error: unknown) {
    if (error instanceof GraphCycleError) {
      throw new GraphValidationError(error.message);
    }
    throw error;
  }
}

// --- Build adjacency list ---

function buildAdjacency(
  nodes: ReadonlyMap<string, GraphNode>,
  edges: ReadonlyArray<GraphEdge>
): ReadonlyMap<string, ReadonlyArray<GraphEdge>> {
  const adj = new Map<string, Array<GraphEdge>>();
  for (const id of nodes.keys()) {
    adj.set(id, []);
  }
  for (const edge of edges) {
    adj.get(edge.from)?.push(edge);
  }
  return adj;
}

// --- Public API ---

/**
 * Build and validate a computation graph.
 *
 * @throws GraphValidationError on invalid graph structure
 */
export function graph(input: GraphInput): Graph {
  const { config, edges, entry, onEvent, provider } = input;

  const forwardEdges = edges.filter((edge) => !edge.back);
  const backEdges = edges.filter((edge) => edge.back);

  // Build node map
  const nodeMap = new Map<string, GraphNode>();
  for (const node of input.nodes) {
    if (nodeMap.has(node.id)) {
      throw new GraphValidationError(`Duplicate node id: "${node.id}"`);
    }
    nodeMap.set(node.id, node);
  }

  // Validate
  validateEntryExists(nodeMap, entry);
  validateEdgeReferences(nodeMap, edges);
  validateNoSelfEdges(edges);
  validateBackEdges(backEdges);
  validateNoOrphans(nodeMap, forwardEdges, entry);
  const executionOrder = topologicalSort(nodeMap, forwardEdges);

  // Build adjacency
  const adjacency = buildAdjacency(nodeMap, forwardEdges);

  return {
    adjacency,
    backEdges,
    config: { ...DEFAULT_GRAPH_CONFIG, ...config },
    edges: forwardEdges,
    entry,
    executionOrder,
    nodes: nodeMap,
    onEvent,
    provider,
  };
}
