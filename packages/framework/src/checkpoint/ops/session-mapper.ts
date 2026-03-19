import type { JsonPlusSerializer } from "../serializer";
import type { Session } from "../types";
import {
  deserializeOptionalValue,
  mapColumn,
  mapNumericColumn,
  requireRecordValue,
  type SessionRowLike,
} from "./mapper-primitives";

export function mapSessionRow(serializer: JsonPlusSerializer, row: SessionRowLike): Session {
  return {
    createdAt: mapNumericColumn(row, "createdAt", "created_at"),
    directory: row.directory,
    id: row.id,
    metadata: deserializeOptionalValue(serializer, row.metadata, requireRecordValue, "metadata"),
    title: row.title ?? undefined,
    updatedAt: mapNumericColumn(row, "updatedAt", "updated_at"),
    workspaceId: mapColumn(row, "workspaceId", "workspace_id"),
  };
}
