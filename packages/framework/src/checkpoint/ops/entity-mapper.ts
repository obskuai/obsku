import type { Entity } from "../../memory/index";
import type { JsonPlusSerializer } from "../serializer";
import {
  deserializeValue,
  type EntityRowLike,
  mapColumn,
  mapNumericColumn,
  mapRequiredStringColumn,
  parseEmbedding,
  requireRecordValue,
  requireRelationshipArrayValue,
} from "./mapper-primitives";

export function mapEntityRow(serializer: JsonPlusSerializer, row: EntityRowLike): Entity {
  return {
    attributes: deserializeValue(serializer, row.attributes, {}, requireRecordValue, "attributes"),
    createdAt: mapNumericColumn(row, "createdAt", "created_at"),
    embedding: parseEmbedding(row.embedding),
    id: row.id,
    name: row.name,
    relationships: deserializeValue(
      serializer,
      row.relationships,
      [],
      requireRelationshipArrayValue,
      "relationships"
    ),
    sessionId: mapRequiredStringColumn(row, "sessionId", "session_id"),
    type: row.type,
    updatedAt: mapNumericColumn(row, "updatedAt", "updated_at"),
    workspaceId: mapColumn(row, "workspaceId", "workspace_id"),
  };
}
