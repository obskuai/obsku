import type { Entity } from "../../memory/index";
import type { Checkpoint, StoredMessage } from "../types";
import type { NumberLike } from "./value-validators";

export type EntityRowLike = {
  attributes?: string | Record<string, unknown> | null;
  embedding?: string | number[] | Uint8Array | null;
  id: string;
  name: string;
  relationships?: string | Entity["relationships"] | null;
  type: string;
} & (
  | { createdAt: NumberLike; sessionId: string; updatedAt: NumberLike; workspaceId?: string | null }
  | {
      created_at: NumberLike;
      session_id: string;
      updated_at: NumberLike;
      workspace_id: string | null;
    }
);

export type FactRowLike = {
  confidence: number;
  content: string;
  embedding?: string | number[] | Uint8Array | null;
  id: string;
} & (
  | { createdAt: NumberLike; sourceSessionId?: string | null; workspaceId?: string | null }
  | { created_at: NumberLike; source_session_id: string | null; workspace_id: string | null }
);

export type SessionRowLike = {
  directory: string;
  id: string;
  metadata?: string | Record<string, unknown> | null;
  title?: string | null;
} & (
  | { createdAt: NumberLike; updatedAt: NumberLike; workspaceId?: string | null }
  | { created_at: NumberLike; updated_at: NumberLike; workspace_id: string | null }
);

export type MessageRowLike = {
  content: string | null | undefined;
  id: number;
  role: StoredMessage["role"];
  tokensIn?: number | null;
  tokensOut?: number | null;
  toolCalls?: string | StoredMessage["toolCalls"] | null;
  toolResults?: string | StoredMessage["toolResults"] | null;
} & (
  | { createdAt: NumberLike; sessionId: string }
  | {
      created_at: NumberLike;
      session_id: string;
      tokens_in?: number | null;
      tokens_out?: number | null;
      tool_calls?: string | StoredMessage["toolCalls"] | null;
      tool_results?: string | StoredMessage["toolResults"] | null;
    }
);

export type CheckpointRowLike = {
  cycleState?: string | Checkpoint["cycleState"] | null;
  id: string;
  namespace: string;
  nodeResults?: string | Checkpoint["nodeResults"];
  pendingNodes?: string | Checkpoint["pendingNodes"] | null;
  source: Checkpoint["source"];
  step: number;
  version: number;
} & (
  | { createdAt: NumberLike; nodeId?: string | null; parentId?: string | null; sessionId: string }
  | {
      created_at: NumberLike;
      cycle_state?: string | Checkpoint["cycleState"] | null;
      node_id: string | null;
      node_results?: string | Checkpoint["nodeResults"];
      parent_id: string | null;
      pending_nodes?: string | Checkpoint["pendingNodes"] | null;
      session_id: string;
    }
);
