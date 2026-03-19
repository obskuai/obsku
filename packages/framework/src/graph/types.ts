// =============================================================================
// @obsku/framework — Graph type definitions
// =============================================================================

import type { Checkpoint, CheckpointBackend } from "../checkpoint/index";
import { DEFAULTS } from "../defaults";
import type { AgentDef, AgentEvent, LLMProvider } from "../types";

// --- Node Status ---

export type NodeStatus = "Pending" | "Running" | "Complete" | "Failed" | "Skipped";

// --- Graph Status ---

export type GraphStatus = "Pending" | "Running" | "Complete" | "Failed" | "Interrupted";

export interface GraphFailureEnvelope<T = unknown> {
  readonly error: string;
  readonly result?: T;
}

export function isGraphFailureEnvelope(value: unknown): value is GraphFailureEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  );
}

export function makeGraphFailureEnvelope<T>(error: string, result?: T): GraphFailureEnvelope<T> {
  return result === undefined ? { error } : { error, result };
}

export function getGraphFailureError(value: unknown): string {
  return isGraphFailureEnvelope(value) ? value.error : String(value);
}

// --- Node Result ---

export interface CompleteNodeResult {
  readonly duration: number;
  readonly output: unknown;
  readonly status: "Complete";
}

export interface FailedNodeResult {
  readonly duration: number;
  readonly output: GraphFailureEnvelope;
  readonly status: "Failed";
}

export interface SkippedNodeResult {
  readonly duration: number;
  readonly output: undefined;
  readonly status: "Skipped";
}

export type NodeResult = CompleteNodeResult | FailedNodeResult | SkippedNodeResult;

// --- Graph Node ---

/**
 * A node in the computation graph.
 * Executor is either an AgentDef (run as sub-agent) or a custom async function.
 */
export interface GraphNode {
  readonly description?: string;
  readonly executor: AgentDef | Graph | ((input: unknown) => Promise<unknown>);
  readonly id: string;
}

// --- Graph Edge ---

/**
 * A directed edge between two nodes.
 * Optional condition predicate gates traversal (defaults to always-true).
 */
export interface GraphEdge {
  /** Marks this edge as a back-edge for cyclic graphs. */
  readonly back?: boolean;
  readonly condition?: (result: unknown) => boolean;
  readonly from: string;
  /** Max times this back-edge may be traversed. */
  readonly maxIterations?: number;
  readonly to: string;
  /** Optional termination predicate for back-edge traversal. */
  readonly until?: (result: unknown) => boolean;
}

// --- Graph Config ---

export interface GraphConfig {
  /** Max concurrent node executions (default: 3) */
  readonly maxConcurrent: number;
  /** Node execution timeout in ms (default: 300_000 = 5 min) */
  readonly nodeTimeout: number;
}

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
  maxConcurrent: 3,
  nodeTimeout: DEFAULTS.nodeTimeout,
};

// --- Graph Definition ---

export interface GraphInput {
  readonly config?: Partial<GraphConfig>;
  readonly edges: ReadonlyArray<GraphEdge>;
  readonly entry: string;
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly onEvent?: (event: AgentEvent) => void;
  readonly provider: LLMProvider;
}

export interface Graph {
  /** Adjacency list: nodeId → outgoing edges */
  readonly adjacency: ReadonlyMap<string, ReadonlyArray<GraphEdge>>;
  readonly backEdges: ReadonlyArray<GraphEdge>;
  readonly config: GraphConfig;
  readonly edges: ReadonlyArray<GraphEdge>;
  readonly entry: string;
  /** Topologically sorted execution order */
  readonly executionOrder: ReadonlyArray<string>;
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly onEvent?: (event: AgentEvent) => void;
  readonly provider: LLMProvider;
}

/** Input type for toposort validation - only needs edges and nodes */
export interface ToposortInput {
  readonly edges: ReadonlyArray<GraphEdge>;
  readonly nodes: ReadonlyMap<string, GraphNode>;
}

// --- Graph Result ---

export interface CompleteGraphResult {
  readonly results: Record<string, NodeResult>;
  readonly status: "Complete";
}

export interface FailedGraphResult {
  readonly error: GraphFailureEnvelope;
  readonly results: Record<string, NodeResult>;
  readonly status: "Failed";
}

export interface InterruptedGraphResult {
  readonly results: Record<string, NodeResult>;
  readonly status: "Interrupted";
}

export type GraphResult = CompleteGraphResult | FailedGraphResult | InterruptedGraphResult;

// --- Execute Graph Options ---

export interface ExecuteGraphOptions {
  checkpointStore?: CheckpointBackend;
  input?: unknown;
  /** Input to pass to a resumed interrupted node */
  interruptInput?: unknown;
  namespace?: string;
  onCheckpoint?: (checkpoint: Checkpoint) => void;
  resumeFrom?: Checkpoint;
  sessionId?: string;
}

// --- Type guards ---

export function isAgentDef(executor: GraphNode["executor"]): executor is AgentDef {
  return (
    typeof executor === "object" && executor !== null && "name" in executor && "prompt" in executor
  );
}

export function isGraph(executor: GraphNode["executor"]): executor is Graph {
  return (
    typeof executor === "object" && executor !== null && "nodes" in executor && "edges" in executor
  );
}

// --- Constants ---

export const MAX_GRAPH_DEPTH = 3;
