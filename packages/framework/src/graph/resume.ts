// =============================================================================
// @obsku/framework — Graph resume from checkpoint
// =============================================================================

import type { CheckpointStore } from "../checkpoint/index";
import type { AgentEvent } from "../types";
import { GraphCheckpointNotFoundError } from "./errors";
import { executeGraph } from "./executor";
import type { Graph, GraphResult } from "./types";

export async function resumeGraph(
  graph: Graph,
  checkpointId: string,
  store: CheckpointStore,
  input?: unknown,
  onEvent?: (event: AgentEvent) => void
): Promise<GraphResult> {
  const checkpoint = await store.getCheckpoint(checkpointId);
  if (!checkpoint) {
    throw new GraphCheckpointNotFoundError(checkpointId);
  }

  return executeGraph(graph, onEvent, 1, {
    checkpointStore: store,
    interruptInput: input,
    namespace: checkpoint.namespace,
    resumeFrom: checkpoint,
    sessionId: checkpoint.sessionId,
  });
}
