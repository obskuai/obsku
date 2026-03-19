import type { Fact, ListFactsOptions } from "../../memory/index";
import type { JsonPlusSerializer } from "../serializer";
import { mapFactRow } from "./base-mappers";
import { buildFact } from "./shared-helpers";
import { FACT_SELECT_COLS, buildWhereClause, buildLimitClause } from "./sql-helpers";
import type { SqlExecutor } from "./sql-types";

type FactRow = {
  confidence: number;
  content: string;
  createdAt: number;
  embedding: string | null;
  id: string;
  sourceSessionId: string | null;
  workspaceId: string | null;
};

export async function sqlSaveFact(
  executor: SqlExecutor,
  _serializer: JsonPlusSerializer,
  fact: Omit<Fact, "id" | "createdAt">
): Promise<Fact> {
  const saved = buildFact(fact);

  await executor.execute(
    `INSERT INTO facts (id, workspace_id, content, confidence, source_session_id, created_at, embedding)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      saved.id,
      saved.workspaceId ?? null,
      saved.content,
      saved.confidence,
      saved.sourceSessionId ?? null,
      saved.createdAt,
      saved.embedding ? JSON.stringify(saved.embedding) : null,
    ]
  );

  return saved;
}

export async function sqlGetFact(
  executor: SqlExecutor,
  serializer: JsonPlusSerializer,
  id: string
): Promise<Fact | null> {
  const row = await executor.queryOne<FactRow>(
    `SELECT ${FACT_SELECT_COLS} FROM facts WHERE id = ?`,
    [id]
  );

  return row ? mapFactRow(row) : null;
}

export async function sqlListFacts(
  executor: SqlExecutor,
  serializer: JsonPlusSerializer,
  options: ListFactsOptions
): Promise<Array<Fact>> {
  const conditions: Array<string> = [];
  const params: Array<string | number> = [];

  if (options.workspaceId) {
    conditions.push("workspace_id = ?");
    params.push(options.workspaceId);
  }
  if (options.minConfidence !== undefined) {
    conditions.push("confidence >= ?");
    params.push(options.minConfidence);
  }

  const whereClause = buildWhereClause(conditions);
  const limitClause = buildLimitClause(options.limit);

  const rows = await executor.queryAll<FactRow>(
    `SELECT ${FACT_SELECT_COLS} FROM facts ${whereClause} ORDER BY created_at DESC${limitClause}`,
    params
  );

  return rows.map((row) => mapFactRow(row));
}

export async function sqlDeleteFact(executor: SqlExecutor, id: string): Promise<void> {
  await executor.execute(`DELETE FROM facts WHERE id = ?`, [id]);
}
