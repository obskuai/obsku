// =============================================================================
// @obsku/framework — Graph Checkpoint Utilities
// =============================================================================

import type { Checkpoint, CheckpointBackend } from "../checkpoint/index";
import type { InterruptError } from "../interrupt/types";
import type { AgentEvent } from "../types/events/index";
import type { NodeResult } from "./types";

async function nextCheckpointVersion(
  store: CheckpointBackend,
  sessionId: string,
  namespace: string
): Promise<number> {
  const existing = await store.listCheckpoints(sessionId, { namespace, limit: 1 });
  const maxVersion = existing.length > 0 ? existing[0].version : 0;
  return maxVersion + 1;
}

/**
 * Maps a framework NodeResult to a checkpoint NodeResult.
 *
 * This helper centralizes the conversion logic between the framework's
 * internal node result format and the checkpoint storage format.
 *
 * @param nodeResult - The framework node result to convert
 * @returns The checkpoint-compatible node result
 */
export function mapNodeResultToCheckpoint(
  nodeResult: NodeResult
): Checkpoint["nodeResults"][string] {
  return {
    completedAt: Date.now(),
    output: nodeResult.output,
    startedAt: Date.now() - nodeResult.duration,
    status:
      nodeResult.status === "Complete"
        ? "completed"
        : nodeResult.status === "Failed"
          ? "failed"
          : "pending",
  };
}

/**
 * Maps a Map of framework NodeResults to a checkpoint-compatible Record.
 *
 * @param results - Map of node IDs to framework NodeResults
 * @returns Record of node IDs to checkpoint NodeResults
 */
export function mapNodeResultsToCheckpoint(
  results: Map<string, NodeResult>
): Record<string, Checkpoint["nodeResults"][string]> {
  const checkpointNodeResults: Record<string, Checkpoint["nodeResults"][string]> = {};

  for (const [nodeId, result] of results) {
    checkpointNodeResults[nodeId] = mapNodeResultToCheckpoint(result);
  }

  return checkpointNodeResults;
}

// --- Internal helpers ---

function computeCheckpointPayload(
  allNodeIds: Array<string>,
  results: Map<string, NodeResult>
): {
  checkpointNodeResults: Record<string, Checkpoint["nodeResults"][string]>;
  pendingNodes: Array<string>;
} {
  return {
    checkpointNodeResults: mapNodeResultsToCheckpoint(results),
    pendingNodes: allNodeIds.filter((id) => !results.has(id)),
  };
}

// --- Checkpoint save helpers ---

export interface SaveInterruptCheckpointOptions {
  allNodeIds: Array<string>;
  cycleState?: { backEdge: string; iteration: number };
  interruptError: InterruptError;
  namespace: string;
  nodeId: string;
  onCheckpoint?: (checkpoint: Checkpoint) => void;
  onEvent?: (event: AgentEvent) => void;
  results: Map<string, NodeResult>;
  sessionId: string;
  step: number;
  store: CheckpointBackend;
}

/**
 * Save checkpoint when graph execution is interrupted, then emit event.
 * Consolidates wave-interrupt and cycle-interrupt checkpoint logic.
 */
export async function saveInterruptCheckpoint(
  opts: SaveInterruptCheckpointOptions
): Promise<Checkpoint> {
  const { checkpointNodeResults, pendingNodes } = computeCheckpointPayload(
    opts.allNodeIds,
    opts.results
  );

  const checkpoint = await opts.store.saveCheckpoint({
    namespace: opts.namespace,
    nodeId: opts.nodeId,
    nodeResults: checkpointNodeResults,
    pendingNodes,
    sessionId: opts.sessionId,
    source: "interrupt",
    step: opts.step,
    version: await nextCheckpointVersion(opts.store, opts.sessionId, opts.namespace),
    ...(opts.cycleState ? { cycleState: opts.cycleState } : {}),
  });

  if (opts.onCheckpoint) {
    opts.onCheckpoint(checkpoint);
  }

  opts.onEvent?.({
    checkpointId: checkpoint.id,
    nodeId: opts.nodeId,
    reason: opts.interruptError.config.reason,
    requiresInput: opts.interruptError.config.requiresInput ?? false,
    timestamp: Date.now(),
    type: "graph.interrupt",
  });

  opts.onEvent?.({
    checkpointId: checkpoint.id,
    namespace: opts.namespace,
    nodeId: opts.nodeId,
    source: "interrupt",
    step: opts.step,
    timestamp: Date.now(),
    type: "checkpoint.saved",
  });

  return checkpoint;
}

export interface SaveCompletionCheckpointOptions {
  allNodeIds: Array<string>;
  cycleState?: { backEdge: string; iteration: number };
  namespace: string;
  onCheckpoint?: (checkpoint: Checkpoint) => void;
  results: Map<string, NodeResult>;
  sessionId: string;
  step: number;
  store: CheckpointBackend;
  onEvent?: (event: AgentEvent) => void;
}

/**
 * Save checkpoint after wave/cycle completes successfully.
 * Consolidates wave-completion and cycle-completion checkpoint logic.
 */
export async function saveCompletionCheckpoint(
  opts: SaveCompletionCheckpointOptions
): Promise<void> {
  const { checkpointNodeResults, pendingNodes } = computeCheckpointPayload(
    opts.allNodeIds,
    opts.results
  );

  const checkpoint = await opts.store.saveCheckpoint({
    namespace: opts.namespace,
    nodeResults: checkpointNodeResults,
    pendingNodes,
    sessionId: opts.sessionId,
    source: "loop",
    step: opts.step,
    version: await nextCheckpointVersion(opts.store, opts.sessionId, opts.namespace),
    ...(opts.cycleState ? { cycleState: opts.cycleState } : {}),
  });

  if (opts.onCheckpoint) {
    opts.onCheckpoint(checkpoint);
  }

  opts.onEvent?.({
    checkpointId: checkpoint.id,
    namespace: opts.namespace,
    source: "loop",
    step: opts.step,
    timestamp: Date.now(),
    type: "checkpoint.saved",
  });
}
