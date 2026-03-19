import type { JsonPlusSerializer } from "../serializer";
import type { Session, SessionOptions } from "../types";
import { mapSessionRow } from "./base-mappers";
import { buildSession, mapRows } from "./shared-helpers";
import type { SqlExecutor } from "./sql-types";

type SessionRow = Omit<Session, "metadata"> & {
  metadata: string | null;
  title: string | null;
  workspaceId: string | null;
};

export async function sqlCreateSession(
  executor: SqlExecutor,
  serializer: JsonPlusSerializer,
  directory: string,
  options: SessionOptions = {}
): Promise<Session> {
  const session = buildSession(directory, options);

  await executor.execute(
    `INSERT INTO sessions (id, workspace_id, title, directory, created_at, updated_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.workspaceId ?? null,
      session.title ?? null,
      session.directory,
      session.createdAt,
      session.updatedAt,
      session.metadata ? serializer.serialize(session.metadata) : null,
    ]
  );

  return session;
}

export async function sqlGetSession(
  executor: SqlExecutor,
  serializer: JsonPlusSerializer,
  sessionId: string
): Promise<Session | null> {
  const row = await executor.queryOne<SessionRow>(
    `SELECT id, workspace_id as workspaceId, title, directory, created_at as createdAt, updated_at as updatedAt, metadata
     FROM sessions WHERE id = ?`,
    [sessionId]
  );

  return row ? mapSessionRow(serializer, row) : null;
}

export async function sqlListSessions(
  executor: SqlExecutor,
  serializer: JsonPlusSerializer,
  workspaceId?: string
): Promise<Array<Session>> {
  const query = workspaceId
    ? `SELECT id, workspace_id as workspaceId, title, directory, created_at as createdAt, updated_at as updatedAt, metadata
       FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC`
    : `SELECT id, workspace_id as workspaceId, title, directory, created_at as createdAt, updated_at as updatedAt, metadata
       FROM sessions ORDER BY updated_at DESC`;

  const rows = workspaceId
    ? await executor.queryAll<SessionRow>(query, [workspaceId])
    : await executor.queryAll<SessionRow>(query, []);

  return mapRows(rows, serializer, mapSessionRow);
}

export async function sqlUpdateSession(
  executor: SqlExecutor,
  serializer: JsonPlusSerializer,
  sessionId: string,
  updates: Partial<Session>
): Promise<void> {
  const now = Date.now();

  await executor.execute(
    `UPDATE sessions SET workspace_id = COALESCE(?, workspace_id), title = COALESCE(?, title),
     directory = COALESCE(?, directory), metadata = COALESCE(?, metadata), updated_at = ?
     WHERE id = ?`,
    [
      updates.workspaceId ?? null,
      updates.title ?? null,
      updates.directory ?? null,
      updates.metadata ? serializer.serialize(updates.metadata) : null,
      now,
      sessionId,
    ]
  );
}

export async function sqlDeleteSession(executor: SqlExecutor, sessionId: string): Promise<void> {
  await executor.execute(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
}
