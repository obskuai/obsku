import crypto from "node:crypto";
import type { JsonPlusSerializer } from "../serializer";
import type { Checkpoint } from "../types";
import { mapCheckpointRow } from "./base-mappers";
import { mapRows } from "./shared-helpers";
import { buildLimitClause, buildWhereClause, CHECKPOINT_SELECT_COLS } from "./sql-helpers";
import type { SqlExecutor } from "./sql-types";

type CheckpointRow = Omit<
  Checkpoint,
  "nodeResults" | "pendingNodes" | "cycleState" | "parentId" | "nodeId"
> & {
  cycleState: string | null;
  nodeId: string | null;
  nodeResults: string;
  parentId: string | null;
  pendingNodes: string | null;
};

export async function sqlSaveCheckpoint(
  executor: SqlExecutor,
  serializer: JsonPlusSerializer,
  checkpoint: Omit<Checkpoint, "id" | "createdAt">
): Promise<Checkpoint> {
  const now = Date.now();
  const fullCheckpoint: Checkpoint = {
    ...checkpoint,
    createdAt: now,
    id: crypto.randomUUID(),
  };

  await executor.execute(
    `INSERT INTO checkpoints (id, session_id, namespace, parent_id, version, step, node_id, node_results, pending_nodes, cycle_state, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fullCheckpoint.id,
      fullCheckpoint.sessionId,
      fullCheckpoint.namespace,
      fullCheckpoint.parentId ?? null,
      fullCheckpoint.version,
      fullCheckpoint.step,
      fullCheckpoint.nodeId ?? null,
      serializer.serialize(fullCheckpoint.nodeResults),
      fullCheckpoint.pendingNodes ? serializer.serialize(fullCheckpoint.pendingNodes) : null,
      fullCheckpoint.cycleState ? serializer.serialize(fullCheckpoint.cycleState) : null,
      fullCheckpoint.source,
      fullCheckpoint.createdAt,
    ]
  );

  return fullCheckpoint;
}

export async function sqlGetCheckpoint(
  executor: SqlExecutor,
  serializer: JsonPlusSerializer,
  checkpointId: string
): Promise<Checkpoint | null> {
  const row = await executor.queryOne<CheckpointRow>(
    `SELECT ${CHECKPOINT_SELECT_COLS} FROM checkpoints WHERE id = ?`,
    [checkpointId]
  );

  return row ? mapCheckpointRow(serializer, row) : null;
}

export async function sqlGetLatestCheckpoint(
  executor: SqlExecutor,
  serializer: JsonPlusSerializer,
  sessionId: string,
  namespace?: string
): Promise<Checkpoint | null> {
  const conditions = ["session_id = ?"];
  const queryParams: Array<string | number> = [sessionId];
  if (namespace !== undefined) {
    conditions.push("namespace = ?");
    queryParams.push(namespace);
  }
  const query = `SELECT ${CHECKPOINT_SELECT_COLS} FROM checkpoints ${buildWhereClause(conditions)} ORDER BY step DESC, created_at DESC LIMIT 1`;
  const row = await executor.queryOne<CheckpointRow>(query, queryParams);

  return row ? mapCheckpointRow(serializer, row) : null;
}

export async function sqlListCheckpoints(
  executor: SqlExecutor,
  serializer: JsonPlusSerializer,
  sessionId: string,
  options: { limit?: number; namespace?: string } = {}
): Promise<Array<Checkpoint>> {
  const conditions: Array<string> = ["session_id = ?"];
  const params: Array<string | number> = [sessionId];

  if (options.namespace !== undefined) {
    conditions.push("namespace = ?");
    params.push(options.namespace);
  }

  const whereClause = buildWhereClause(conditions);
  const limitClause = buildLimitClause(options.limit, params);
  const query = `SELECT ${CHECKPOINT_SELECT_COLS} FROM checkpoints ${whereClause} ORDER BY step DESC, created_at DESC${limitClause}`;

  const rows = await executor.queryAll<CheckpointRow>(query, params);
  return mapRows(rows, serializer, mapCheckpointRow);
}
