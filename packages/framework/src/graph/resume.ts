// =============================================================================
// @obsku/framework — Graph resume from checkpoint
// =============================================================================

import type { CheckpointBackend } from "../checkpoint/index";
import type { DefaultPublicPayload } from "../output-policy";
import { loadOutputPolicy } from "../output-policy";
import type { AgentEvent } from "../types";
import { GraphCheckpointNotFoundError } from "./errors";
import { executeGraph } from "./executor";
import type { Graph, GraphResult } from "./types";

export async function resumeGraph(
  graph: Graph,
  checkpointId: string,
  store: CheckpointBackend,
  input?: unknown,
  onEvent?: (event: DefaultPublicPayload<AgentEvent>) => void
): Promise<GraphResult> {
  const outputPolicy = loadOutputPolicy();
  const checkpoint = await store.getCheckpoint(checkpointId);
  if (!checkpoint) {
    throw new GraphCheckpointNotFoundError(checkpointId);
  }

  return executeGraph(graph, onEvent, 1, {
    checkpointStore: store,
    interruptInput: input,
    namespace: checkpoint.namespace,
    outputPolicy,
    resumeFrom: checkpoint,
    sessionId: checkpoint.sessionId,
  });
}
