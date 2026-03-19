import type { Entity, Fact, SemanticSearchOptions } from "../../memory/index";
import { EntitySchema, validate } from "../schemas";
import type { JsonPlusSerializer } from "../serializer";
import { cosineSimilarity, deserializeEmbedding, rankScoredItems } from "../similarity";
import type { SqlExecutor } from "./sql-types";
import { ENTITY_SELECT_COLS, FACT_SELECT_COLS, buildWhereClauseRequired } from "./sql-helpers";

type EntityRow = {
  attributes: string;
  createdAt: number;
  embedding: Uint8Array | string;
  id: string;
  name: string;
  relationships: string;
  sessionId: string;
  type: string;
  updatedAt: number;
  workspaceId: string | null;
};

type FactRow = {
  confidence: number;
  content: string;
  createdAt: number;
  embedding: Uint8Array | string;
  id: string;
  sourceSessionId: string | null;
  workspaceId: string | null;
};

/**
 * Score rows by cosine similarity and apply the canonical ranking policy
 * (see rankScoredItems in similarity.ts). Uses full sort rather than a heap
 * because N is already bounded by SQL pre-filtering (WHERE embedding IS NOT NULL).
 */
function scoreAndRank<TRow extends { embedding: Uint8Array | string | null }, T>(
  rows: Array<TRow>,
  queryEmbedding: Array<number>,
  threshold: number,
  topK: number,
  mapItem: (row: TRow) => T
): Array<T> {
  const scored = rows
    .filter((row): row is TRow & { embedding: Uint8Array | string } => !!row.embedding)
    .map((row) => {
      const itemEmbedding = deserializeEmbedding(row.embedding);
      if (!itemEmbedding) {
        return null;
      }
      return {
        item: mapItem(row),
        similarity: cosineSimilarity(queryEmbedding, itemEmbedding),
      };
    })
    .filter((entry): entry is { item: T; similarity: number } => entry !== null);

  return rankScoredItems(scored, threshold, topK);
}

export async function sqlSearchEntitiesSemantic(
  executor: SqlExecutor,
  serializer: JsonPlusSerializer,
  embedding: Array<number>,
  options: SemanticSearchOptions = {}
): Promise<Array<Entity>> {
  const { sessionId, threshold = 0, topK = 10, workspaceId } = options;

  const conditions: Array<string> = ["embedding IS NOT NULL"];
  const params: Array<string | number> = [];

  if (sessionId) {
    conditions.push("session_id = ?");
    params.push(sessionId);
  }
  if (workspaceId) {
    conditions.push("workspace_id = ?");
    params.push(workspaceId);
  }

  const whereClause = buildWhereClauseRequired(conditions);

  const rows = await executor.queryAll<EntityRow>(
    `SELECT ${ENTITY_SELECT_COLS} FROM entities ${whereClause}`,
    params
  );

  return scoreAndRank(rows, embedding, threshold, topK, (row) => {
    const attributes = validate(
      EntitySchema.shape.attributes,
      serializer.deserialize(row.attributes)
    );
    if (!attributes) {
      process.emitWarning("Invalid entity attributes in sql search; using empty object.", {
        code: "OBSKU_SQL_ENTITY_ATTRIBUTES",
        detail: `entityId=${row.id}`,
        type: "DataValidation",
      });
    }

    const relationships = validate(
      EntitySchema.shape.relationships,
      serializer.deserialize(row.relationships)
    );
    if (!relationships) {
      process.emitWarning("Invalid entity relationships in sql search; using empty array.", {
        code: "OBSKU_SQL_ENTITY_RELATIONSHIPS",
        detail: `entityId=${row.id}`,
        type: "DataValidation",
      });
    }

    return {
      attributes: attributes ?? {},
      createdAt: row.createdAt,
      id: row.id,
      name: row.name,
      relationships: relationships ?? [],
      sessionId: row.sessionId,
      type: row.type,
      updatedAt: row.updatedAt,
      workspaceId: row.workspaceId ?? undefined,
    };
  });
}

export async function sqlSearchFactsSemantic(
  executor: SqlExecutor,
  _serializer: JsonPlusSerializer,
  embedding: Array<number>,
  options: SemanticSearchOptions = {}
): Promise<Array<Fact>> {
  const { threshold = 0, topK = 10, workspaceId } = options;

  const conditions: Array<string> = ["embedding IS NOT NULL"];
  const params: Array<string | number> = [];

  if (workspaceId) {
    conditions.push("workspace_id = ?");
    params.push(workspaceId);
  }

  const whereClause = buildWhereClauseRequired(conditions);

  const rows = await executor.queryAll<FactRow>(
    `SELECT ${FACT_SELECT_COLS} FROM facts ${whereClause}`,
    params
  );

  return scoreAndRank(rows, embedding, threshold, topK, (row) => ({
    confidence: row.confidence,
    content: row.content,
    createdAt: row.createdAt,
    id: row.id,
    sourceSessionId: row.sourceSessionId ?? undefined,
    workspaceId: row.workspaceId ?? undefined,
  }));
}
