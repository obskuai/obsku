import type { Entity, Fact, ListEntitiesOptions, ListFactsOptions } from "../memory/index";
import type { ToolCall } from "../types/llm";

export interface StoredToolResult {
  content: string;
  fullOutputRef?: string;
  status?: string;
  toolUseId: string;
}

export interface CheckpointNodeResult {
  completedAt?: number;
  error?: string;
  output?: unknown;
  startedAt?: number;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

export interface Session {
  createdAt: number;
  directory: string;
  id: string;
  metadata?: Record<string, unknown>;
  title?: string;
  updatedAt: number;
  workspaceId?: string;
}

export interface StoredMessage {
  content?: string;
  createdAt: number;
  id: number;
  role: "user" | "assistant" | "system" | "tool";
  sessionId: string;
  tokensIn?: number;
  tokensOut?: number;
  toolCalls?: Array<ToolCall>;
  toolResults?: Array<StoredToolResult>;
}

export interface Checkpoint {
  createdAt: number;
  cycleState?: {
    backEdge: string;
    iteration: number;
  };
  id: string;
  namespace: string;
  nodeId?: string;
  nodeResults: Record<string, CheckpointNodeResult>;
  parentId?: string;
  pendingNodes: Array<string>;
  sessionId: string;
  source: "input" | "loop" | "interrupt" | "fork";
  step: number;
  version: number;
}

export interface SessionOptions {
  metadata?: Record<string, unknown>;
  title?: string;
  workspaceId?: string;
}

export interface CheckpointStore {
  addMessage(
    sessionId: string,
    message: Omit<StoredMessage, "id" | "createdAt">
  ): Promise<StoredMessage>;
  close(): Promise<void>;
  createSession(directory: string, options?: SessionOptions): Promise<Session>;
  deleteSession(sessionId: string): Promise<void>;
  fork(checkpointId: string, options?: { title?: string }): Promise<Session>;

  getCheckpoint(checkpointId: string): Promise<Checkpoint | null>;
  getLatestCheckpoint(sessionId: string, namespace?: string): Promise<Checkpoint | null>;

  getMessages(
    sessionId: string,
    options?: { before?: number; limit?: number }
  ): Promise<Array<StoredMessage>>;
  getSession(sessionId: string): Promise<Session | null>;
  listCheckpoints(
    sessionId: string,
    options?: { limit?: number; namespace?: string }
  ): Promise<Array<Checkpoint>>;
  listSessions(workspaceId?: string): Promise<Array<Session>>;

  updateSession(sessionId: string, updates: Partial<Session>): Promise<void>;
}

/**
 * Extended checkpoint store interface for backend implementers only.
 * Includes framework-internal checkpoint persistence via saveCheckpoint.
 */
export interface CheckpointBackend extends CheckpointStore {
  saveCheckpoint(checkpoint: Omit<Checkpoint, "id" | "createdAt">): Promise<Checkpoint>;
}

/**
 * Extended checkpoint store with memory operations for Entity and Fact persistence.
 * Implementations should extend CheckpointBackend and add entity/fact CRUD methods.
 */
export interface MemoryStore extends CheckpointBackend {
  deleteEntity(id: string): Promise<void>;
  deleteFact(id: string): Promise<void>;
  getEntity(id: string): Promise<Entity | null>;
  getFact(id: string): Promise<Fact | null>;
  hasSemanticSearch: boolean;
  listEntities(options: ListEntitiesOptions): Promise<Array<Entity>>;

  listFacts(options: ListFactsOptions): Promise<Array<Fact>>;
  saveEntity(entity: Omit<Entity, "id" | "createdAt" | "updatedAt">): Promise<Entity>;
  saveFact(fact: Omit<Fact, "id" | "createdAt">): Promise<Fact>;
  updateEntity(id: string, updates: Partial<Entity>): Promise<void>;
}

export interface Serializer {
  deserialize(data: string): unknown;
  serialize(value: unknown): string;
}
