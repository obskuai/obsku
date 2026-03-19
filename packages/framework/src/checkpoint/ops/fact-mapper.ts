import type { Fact } from "../../memory/index";
import { type FactRowLike, mapColumn, mapNumericColumn, parseEmbedding } from "./mapper-primitives";

export function mapFactRow(row: FactRowLike): Fact {
  return {
    confidence: row.confidence,
    content: row.content,
    createdAt: mapNumericColumn(row, "createdAt", "created_at"),
    embedding: parseEmbedding(row.embedding),
    id: row.id,
    sourceSessionId: mapColumn(row, "sourceSessionId", "source_session_id"),
    workspaceId: mapColumn(row, "workspaceId", "workspace_id"),
  };
}
