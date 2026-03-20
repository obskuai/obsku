import crypto from "node:crypto";
import type { Checkpoint, Session } from "@obsku/framework";
import {
  CheckpointNotFoundError,
  JsonPlusSerializer,
  mapCheckpointRow,
  mapSessionRow,
  SessionNotFoundError,
} from "@obsku/framework/checkpoint/backend-shared";
import type { Pool as PoolType } from "pg";

// Database row types (previously imported from deleted ops files)
interface CheckpointRow {
  [key: string]: unknown;
  created_at: number;
  cycle_state: string | null;
  id: string;
  namespace: string;
  node_id: string | null;
  node_results: string;
  parent_id: string | null;
  pending_nodes: string | null;
  session_id: string;
  source: "input" | "loop" | "interrupt" | "fork";
  step: number;
  version: number;
}

interface MessageRow {
  content: string | null;
  created_at: number;
  id: number;
  role: string;
  session_id: string;
  tokens_in: number | null;
  tokens_out: number | null;
  tool_calls: string | null;
  tool_results: string | null;
}

interface SessionRow {
  [key: string]: unknown;
  created_at: number;
  directory: string;
  id: string;
  metadata: string | null;
  title: string | null;
  updated_at: number;
  workspace_id: string | null;
}

/** Minimal queryable surface shared by Pool and PoolClient. */
interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: Array<unknown>
  ): Promise<{ rows: Array<T> }>;
}

/**
 * Run a SELECT, map the first row, or throw the caller-supplied error when empty.
 * Used for checkpoint lookup, source-session lookup, and post-commit session re-fetch.
 */
async function queryRowOrThrow<Row extends Record<string, unknown>, T>(
  db: Queryable,
  sql: string,
  params: Array<unknown>,
  onEmpty: () => Error,
  map: (row: Row) => T
): Promise<T> {
  const result = await db.query<Row>(sql, params);
  if (result.rows.length === 0) {
    throw onEmpty();
  }
  return map(result.rows[0] as Row);
}

export async function forkCheckpoint(
  pool: PoolType,
  serializer: JsonPlusSerializer,
  checkpointId: string,
  options: { title?: string } = {}
): Promise<Session> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const checkpoint = await queryRowOrThrow<CheckpointRow, Checkpoint>(
      client,
      `SELECT * FROM checkpoints WHERE id = $1`,
      [checkpointId],
      () => new CheckpointNotFoundError(checkpointId),
      (row) => mapCheckpointRow(serializer, row)
    );

    const originalSession = await queryRowOrThrow<SessionRow, Session>(
      client,
      `SELECT * FROM sessions WHERE id = $1`,
      [checkpoint.sessionId],
      () => new SessionNotFoundError(checkpoint.sessionId),
      (row) => mapSessionRow(serializer, row)
    );

    const now = Date.now();
    const newSessionId = crypto.randomUUID();
    const newTitle = options.title ?? `Fork of ${originalSession.title ?? checkpointId}`;

    await client.query(
      `INSERT INTO sessions (id, workspace_id, title, directory, created_at, updated_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        newSessionId,
        originalSession.workspaceId ?? null,
        newTitle,
        originalSession.directory,
        now,
        now,
        originalSession.metadata ? serializer.serialize(originalSession.metadata) : null,
      ]
    );

    const messagesToCopyResult = await client.query<MessageRow>(
      `SELECT * FROM messages
       WHERE session_id = $1 AND created_at <= $2
       ORDER BY created_at ASC`,
      [checkpoint.sessionId, checkpoint.createdAt]
    );

    for (const msg of messagesToCopyResult.rows) {
      const msgNow = Date.now();
      await client.query(
        `INSERT INTO messages (session_id, role, content, tool_calls, tool_results, tokens_in, tokens_out, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          newSessionId,
          msg.role,
          msg.content,
          msg.tool_calls,
          msg.tool_results,
          msg.tokens_in,
          msg.tokens_out,
          msgNow,
        ]
      );
    }

    const newCheckpointId = crypto.randomUUID();
    const cpNow = Date.now();
    await client.query(
      `INSERT INTO checkpoints (id, session_id, namespace, parent_id, version, step, node_id, node_results, pending_nodes, cycle_state, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        newCheckpointId,
        newSessionId,
        checkpoint.namespace,
        checkpointId,
        checkpoint.version,
        checkpoint.step,
        checkpoint.nodeId ?? null,
        serializer.serialize(checkpoint.nodeResults),
        checkpoint.pendingNodes ? serializer.serialize(checkpoint.pendingNodes) : null,
        checkpoint.cycleState ? serializer.serialize(checkpoint.cycleState) : null,
        "fork",
        cpNow,
      ]
    );

    await client.query("COMMIT");

    return queryRowOrThrow<SessionRow, Session>(
      pool,
      `SELECT * FROM sessions WHERE id = $1`,
      [newSessionId],
      () => new SessionNotFoundError(newSessionId),
      (row) => mapSessionRow(serializer, row)
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
