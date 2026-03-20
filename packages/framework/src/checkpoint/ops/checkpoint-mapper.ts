import type { JsonPlusSerializer } from "../serializer";
import type { Checkpoint } from "../types";
import {
  type CheckpointRowLike,
  deserializeField,
  deserializeValue,
  mapColumn,
  mapNumericColumn,
  mapRequiredStringColumn,
  requireCheckpointNodeResultsValue,
  requireCycleStateValue,
  requireStringArrayValue,
} from "./mapper-primitives";

export function mapCheckpointRow(
  serializer: JsonPlusSerializer,
  row: CheckpointRowLike
): Checkpoint {
  return {
    createdAt: mapNumericColumn(row, "createdAt", "created_at"),
    cycleState: deserializeField<Checkpoint["cycleState"]>(
      mapColumn(row, "cycleState", "cycle_state"),
      serializer,
      requireCycleStateValue,
      "cycleState"
    ),
    id: row.id,
    namespace: row.namespace,
    nodeId: mapColumn(row, "nodeId", "node_id"),
    nodeResults: deserializeValue(
      serializer,
      (row.nodeResults ?? (row as Record<string, unknown>)["node_results"]) as
        | string
        | Checkpoint["nodeResults"]
        | undefined,
      {},
      requireCheckpointNodeResultsValue,
      "nodeResults"
    ),
    parentId: mapColumn(row, "parentId", "parent_id"),
    pendingNodes: deserializeValue(
      serializer,
      (row.pendingNodes ?? (row as Record<string, unknown>)["pending_nodes"]) as
        | string
        | Checkpoint["pendingNodes"]
        | undefined,
      [],
      requireStringArrayValue,
      "pendingNodes"
    ),
    sessionId: mapRequiredStringColumn(row, "sessionId", "session_id"),
    source: row.source,
    step: row.step,
    version: row.version,
  };
}
