import type {
  Checkpoint,
  CheckpointBackend,
  Entity,
  Fact,
  ListEntitiesOptions,
  ListFactsOptions,
  MemoryStoreOperations,
  SemanticSearchOptions,
  Session,
  SessionOptions,
  StoredMessage,
} from "@obsku/framework";
import { forkFromCheckpoint, JsonPlusSerializer } from "@obsku/framework/checkpoint/backend-shared";
import { createClient, type RedisClientType } from "redis";
import {
  getCheckpoint,
  getLatestCheckpoint,
  listCheckpoints,
  saveCheckpoint,
} from "./ops/checkpoints";
import { deleteEntity, getEntity, listEntities, saveEntity, updateEntity } from "./ops/entities";
import { deleteFact, getFact, listFacts, saveFact } from "./ops/facts";
import { addMessage, getMessages } from "./ops/messages";
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  updateSession,
} from "./ops/sessions";

export interface RedisCheckpointStoreOptions {
  prefix?: string;
  url?: string;
}

/**
 * Redis Key Schema for Memory:
 *
 * {prefix}entity:{id}                        → Entity JSON
 * {prefix}entities:session:{sessionId}       → Set of entity IDs
 * {prefix}entities:workspace:{workspaceId}   → Set of entity IDs
 * {prefix}entities:type:{type}               → Set of entity IDs
 *
 * {prefix}fact:{id}                          → Fact JSON
 * {prefix}facts:workspace:{workspaceId}      → Sorted Set (score = confidence)
 */
export class RedisCheckpointStore implements CheckpointBackend, MemoryStoreOperations {
  readonly hasSemanticSearch = false;

  private client: RedisClientType;
  private serializer = new JsonPlusSerializer();
  private prefix: string;
  private connected = false;

  constructor(options: RedisCheckpointStoreOptions = {}) {
    this.client = createClient({ url: options.url });
    this.prefix = options.prefix ?? "obsku:";

    // Return Proxy that auto-calls ensureConnected() before public methods
    return new Proxy(this, {
      get: (target, prop) => {
        const value = (target as Record<string, unknown>)[prop as string];
        if (typeof value === "function" && prop !== "close" && prop !== "ensureConnected") {
          return async (...args: Array<unknown>) => {
            await target.ensureConnected();
            return (value as (...args: Array<unknown>) => unknown).apply(target, args);
          };
        }
        return value;
      },
    }) as RedisCheckpointStore;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
  }

  // Session operations

  async createSession(directory: string, options: SessionOptions = {}): Promise<Session> {
    return createSession(this.client, this.serializer, this.prefix, directory, options);
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return getSession(this.client, this.serializer, this.prefix, sessionId);
  }

  async listSessions(workspaceId?: string): Promise<Array<Session>> {
    return listSessions(this.client, this.serializer, this.prefix, workspaceId);
  }

  async updateSession(sessionId: string, updates: Partial<Session>): Promise<void> {
    return updateSession(this.client, this.serializer, this.prefix, sessionId, updates);
  }

  async deleteSession(sessionId: string): Promise<void> {
    return deleteSession(this.client, this.prefix, sessionId);
  }

  // Message operations

  async addMessage(
    sessionId: string,
    message: Omit<StoredMessage, "id" | "createdAt">
  ): Promise<StoredMessage> {
    return addMessage(this.client, this.serializer, this.prefix, sessionId, message);
  }

  async getMessages(
    sessionId: string,
    options: { before?: number; limit?: number } = {}
  ): Promise<Array<StoredMessage>> {
    return getMessages(this.client, this.serializer, this.prefix, sessionId, options);
  }

  // Checkpoint operations

  async saveCheckpoint(checkpoint: Omit<Checkpoint, "id" | "createdAt">): Promise<Checkpoint> {
    return saveCheckpoint(this.client, this.serializer, this.prefix, checkpoint);
  }

  async getCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
    return getCheckpoint(this.client, this.serializer, this.prefix, checkpointId);
  }

  async getLatestCheckpoint(sessionId: string, namespace?: string): Promise<Checkpoint | null> {
    return getLatestCheckpoint(this.client, this.serializer, this.prefix, sessionId, namespace);
  }

  async listCheckpoints(
    sessionId: string,
    options: { limit?: number; namespace?: string } = {}
  ): Promise<Array<Checkpoint>> {
    return listCheckpoints(this.client, this.serializer, this.prefix, sessionId, options);
  }

  // Fork (crosses sessions, messages, checkpoints domains)

  async fork(checkpointId: string, options: { title?: string } = {}): Promise<Session> {
    return forkFromCheckpoint(this, checkpointId, options);
  }

  // Entity operations

  async saveEntity(entity: Omit<Entity, "id" | "createdAt" | "updatedAt">): Promise<Entity> {
    return saveEntity(this.client, this.serializer, this.prefix, entity);
  }

  async getEntity(id: string): Promise<Entity | null> {
    return getEntity(this.client, this.serializer, this.prefix, id);
  }

  async listEntities(options: ListEntitiesOptions): Promise<Array<Entity>> {
    return listEntities(this.client, this.serializer, this.prefix, options);
  }

  async updateEntity(id: string, updates: Partial<Entity>): Promise<void> {
    return updateEntity(this.client, this.serializer, this.prefix, id, updates);
  }

  async deleteEntity(id: string): Promise<void> {
    return deleteEntity(this.client, this.serializer, this.prefix, id);
  }

  // Fact operations

  async saveFact(fact: Omit<Fact, "id" | "createdAt">): Promise<Fact> {
    return saveFact(this.client, this.serializer, this.prefix, fact);
  }

  async getFact(id: string): Promise<Fact | null> {
    return getFact(this.client, this.serializer, this.prefix, id);
  }

  async listFacts(options: ListFactsOptions): Promise<Array<Fact>> {
    return listFacts(this.client, this.serializer, this.prefix, options);
  }

  async deleteFact(id: string): Promise<void> {
    return deleteFact(this.client, this.serializer, this.prefix, id);
  }

  // Semantic search not implemented for Redis (requires RediSearch module)

  async searchEntitiesSemantic(
    _embedding: Array<number>,
    _options?: SemanticSearchOptions
  ): Promise<Array<Entity>> {
    return [];
  }

  async searchFactsSemantic(
    _embedding: Array<number>,
    _options?: SemanticSearchOptions
  ): Promise<Array<Fact>> {
    return [];
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.quit();
      this.connected = false;
    }
  }
}
