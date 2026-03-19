import type { JsonPlusSerializer } from "../serializer";
import type { StoredMessage } from "../types";
import {
  deserializeField,
  type MessageRowLike,
  mapColumn,
  mapNumericColumn,
  mapRequiredStringColumn,
  requireToolCallsValue,
  requireToolResultsValue,
} from "./mapper-primitives";

export function mapMessageRow(serializer: JsonPlusSerializer, row: MessageRowLike): StoredMessage {
  return {
    content: row.content ?? undefined,
    createdAt: mapNumericColumn(row, "createdAt", "created_at"),
    id: row.id,
    role: row.role,
    sessionId: mapRequiredStringColumn(row, "sessionId", "session_id"),
    tokensIn: mapColumn(row, "tokensIn", "tokens_in"),
    tokensOut: mapColumn(row, "tokensOut", "tokens_out"),
    toolCalls: deserializeField<StoredMessage["toolCalls"]>(
      mapColumn(row, "toolCalls", "tool_calls"),
      serializer,
      requireToolCallsValue,
      "toolCalls"
    ),
    toolResults: deserializeField<StoredMessage["toolResults"]>(
      mapColumn(row, "toolResults", "tool_results"),
      serializer,
      requireToolResultsValue,
      "toolResults"
    ),
  };
}
