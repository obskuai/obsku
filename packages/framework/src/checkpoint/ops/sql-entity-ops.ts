import { coerceNumeric, requireStringValue } from "./base-mappers";
import type { EntityFilterConditions } from "./shared-helpers";
import { buildLimitClause, buildWhereClause, ENTITY_SELECT_COLS } from "./sql-helpers";
import type { SqlExecutor } from "./sql-types";
import type { EntityRow, SaveEntityInput } from "./types";

export type UpdateEntityInput = {
  attributes?: string;
  embedding?: string | null;
  name?: string;
  relationships?: string;
  type?: string;
  updatedAt: number;
  workspaceId?: string | null;
};

// Explicit shape for snake_case entity rows coming from SQL backends.
// Required fields typed as `unknown` force explicit string-guard before use.
type RawEntityDbRow = {
  attributes?: string | null;
  created_at?: number | string | null;
  embedding?: string | null;
  id?: unknown;
  name?: unknown;
  relationships?: string | null;
  session_id?: unknown;
  type?: unknown;
  updated_at?: number | string | null;
  workspace_id?: string | null;
};

// Accepts both camelCase (SQL alias) and snake_case (raw SQL) rows.
// TypeScript narrows to the correct branch via the "sessionId" in-operator guard,
// eliminating the need for a double cast.
const normalizeEntityRow = (row: EntityRow | RawEntityDbRow | null): EntityRow | null => {
  if (!row) {
    return null;
  }

  if ("sessionId" in row) {
    // Already camelCase — returned by queries that use ENTITY_SELECT_COLS aliases.
    return row;
  }

  // Row came from SQL backend with snake_case column names.
  // TypeScript narrows to RawEntityDbRow here; no cast needed.
  return {
    attributes: requireStringValue(row.attributes, "attributes"),
    createdAt: coerceNumeric(row.created_at, "created_at", { strict: true })!,
    embedding: row.embedding ?? null,
    id: requireStringValue(row.id, "id"),
    name: requireStringValue(row.name, "name"),
    relationships: requireStringValue(row.relationships, "relationships"),
    sessionId: requireStringValue(row.session_id, "session_id"),
    type: requireStringValue(row.type, "type"),
    updatedAt: coerceNumeric(row.updated_at, "updated_at", { strict: true })!,
    workspaceId: typeof row.workspace_id === "string" ? row.workspace_id : null,
  };
};

export async function sqlSaveEntity(
  executor: SqlExecutor,
  input: SaveEntityInput
): Promise<EntityRow> {
  await executor.execute(
    "INSERT INTO entities (id, session_id, workspace_id, name, type, attributes, relationships, created_at, updated_at, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      input.id,
      input.sessionId,
      input.workspaceId ?? null,
      input.name,
      input.type,
      input.attributes,
      input.relationships,
      input.createdAt,
      input.updatedAt,
      input.embedding ?? null,
    ]
  );

  return {
    attributes: input.attributes,
    createdAt: input.createdAt,
    embedding: input.embedding ?? null,
    id: input.id,
    name: input.name,
    relationships: input.relationships,
    sessionId: input.sessionId,
    type: input.type,
    updatedAt: input.updatedAt,
    workspaceId: input.workspaceId ?? null,
  };
}

export async function sqlGetEntityById(
  executor: SqlExecutor,
  entityId: string,
  sessionId?: string
): Promise<EntityRow | null> {
  const conditions: Array<string> = ["id = ?"];
  const params: Array<string> = [entityId];

  if (sessionId) {
    conditions.push("session_id = ?");
    params.push(sessionId);
  }

  const row = await executor.queryOne<EntityRow>(
    `SELECT ${ENTITY_SELECT_COLS} FROM entities ${buildWhereClause(conditions)}`,
    params
  );

  return normalizeEntityRow(row);
}

export async function sqlListEntities(
  executor: SqlExecutor,
  options: EntityFilterConditions
): Promise<Array<EntityRow>> {
  const conditions: Array<string> = [];
  const params: Array<string | number> = [];

  for (const filter of options.filters) {
    if (filter.key === "sessionId") {
      conditions.push("session_id = ?");
      params.push(filter.value);
    } else if (filter.key === "workspaceId") {
      conditions.push("workspace_id = ?");
      params.push(filter.value);
    } else {
      conditions.push("type = ?");
      params.push(filter.value);
    }
  }

  let query = `SELECT ${ENTITY_SELECT_COLS} FROM entities`;
  query += buildWhereClause(conditions);
  query += " ORDER BY created_at DESC";
  query += buildLimitClause(options.limit, params);

  const rows = await executor.queryAll<EntityRow>(query, params);
  return rows.map((row) => normalizeEntityRow(row)).filter((row): row is EntityRow => !!row);
}

export async function sqlUpdateEntity(
  executor: SqlExecutor,
  entityId: string,
  updates: UpdateEntityInput
): Promise<void> {
  const setClauses: Array<string> = ["updated_at = ?"];
  const params: Array<string | number | null> = [updates.updatedAt];

  if (updates.name !== undefined) {
    setClauses.push("name = ?");
    params.push(updates.name);
  }
  if (updates.type !== undefined) {
    setClauses.push("type = ?");
    params.push(updates.type);
  }
  if (updates.workspaceId !== undefined) {
    setClauses.push("workspace_id = ?");
    params.push(updates.workspaceId ?? null);
  }
  if (updates.attributes !== undefined) {
    setClauses.push("attributes = ?");
    params.push(updates.attributes);
  }
  if (updates.relationships !== undefined) {
    setClauses.push("relationships = ?");
    params.push(updates.relationships);
  }
  if (updates.embedding !== undefined) {
    setClauses.push("embedding = ?");
    params.push(updates.embedding ?? null);
  }

  params.push(entityId);

  await executor.execute(`UPDATE entities SET ${setClauses.join(", ")} WHERE id = ?`, params);
}

export async function sqlDeleteEntity(executor: SqlExecutor, entityId: string): Promise<void> {
  await executor.execute("DELETE FROM entities WHERE id = ?", [entityId]);
}
