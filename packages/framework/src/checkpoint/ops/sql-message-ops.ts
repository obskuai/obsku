import type { JsonPlusSerializer } from "../serializer";
import type { StoredMessage } from "../types";
import { mapMessageRow } from "./message-mapper";
import { mapRows } from "./shared-helpers";
import type { SqlExecutor } from "./sql-types";

type MessageRow = Omit<StoredMessage, "toolCalls" | "toolResults" | "content"> & {
  content: string | null;
  toolCalls: string | null;
  toolResults: string | null;
};

export async function sqlAddMessage(
  executor: SqlExecutor,
  serializer: JsonPlusSerializer,
  sessionId: string,
  message: Omit<StoredMessage, "id" | "createdAt">
): Promise<StoredMessage> {
  const now = Date.now();

  await executor.execute(
    `INSERT INTO messages (session_id, role, content, tool_calls, tool_results, tokens_in, tokens_out, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      message.role,
      message.content ?? null,
      message.toolCalls ? serializer.serialize(message.toolCalls) : null,
      message.toolResults ? serializer.serialize(message.toolResults) : null,
      message.tokensIn ?? null,
      message.tokensOut ?? null,
      now,
    ]
  );

  await executor.execute(`UPDATE sessions SET updated_at = ? WHERE id = ?`, [now, sessionId]);

  const row = await executor.queryOne<MessageRow>(
    `SELECT id, session_id as sessionId, role, content, tool_calls as toolCalls, tool_results as toolResults,
     tokens_in as tokensIn, tokens_out as tokensOut, created_at as createdAt
     FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1`,
    [sessionId]
  );

  if (row) {
    return mapMessageRow(serializer, row);
  }

  return {
    ...message,
    createdAt: now,
    id: -1,
    sessionId,
  };
}

export async function sqlGetMessages(
  executor: SqlExecutor,
  serializer: JsonPlusSerializer,
  sessionId: string,
  options: { before?: number; limit?: number } = {}
): Promise<Array<StoredMessage>> {
  const conditions: Array<string> = ["session_id = ?"];
  const params: Array<string | number> = [sessionId];

  if (options.before !== undefined) {
    conditions.push("created_at < ?");
    params.push(options.before);
  }

  const selectCols = `id, session_id as sessionId, role, content, tool_calls as toolCalls, tool_results as toolResults,
    tokens_in as tokensIn, tokens_out as tokensOut, created_at as createdAt`;

  let query = `SELECT ${selectCols} FROM messages WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC`;

  if (options.before !== undefined && options.limit !== undefined) {
    query += " LIMIT ?";
    params.push(options.limit);
  }

  let rows = await executor.queryAll<MessageRow>(query, params);

  if (options.limit !== undefined && options.before === undefined) {
    rows = rows.slice(-options.limit);
  }

  return mapRows(rows, serializer, mapMessageRow);
}
