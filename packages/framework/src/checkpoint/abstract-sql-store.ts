import type {
  Entity,
  Fact,
  ListEntitiesOptions,
  ListFactsOptions,
  SemanticSearchOptions,
} from "../memory/index";
import { SessionNotFoundError } from "./errors";
import { mapEntityRow } from "./ops/base-mappers";
import { forkFromCheckpoint } from "./ops/fork";
import { buildEntity, buildFilterConditions, validateEntityExists } from "./ops/shared-helpers";
import {
  sqlGetCheckpoint,
  sqlGetLatestCheckpoint,
  sqlListCheckpoints,
  sqlSaveCheckpoint,
} from "./ops/sql-checkpoint-ops";
import type { UpdateEntityInput } from "./ops/sql-entity-ops";
import {
  sqlDeleteEntity,
  sqlGetEntityById,
  sqlListEntities,
  sqlSaveEntity,
  sqlUpdateEntity,
} from "./ops/sql-entity-ops";
import { sqlDeleteFact, sqlGetFact, sqlListFacts, sqlSaveFact } from "./ops/sql-fact-ops";
import { sqlAddMessage, sqlGetMessages } from "./ops/sql-message-ops";
import { sqlSearchEntitiesSemantic, sqlSearchFactsSemantic } from "./ops/sql-search-ops";
import {
  sqlCreateSession,
  sqlDeleteSession,
  sqlGetSession,
  sqlListSessions,
  sqlUpdateSession,
} from "./ops/sql-session-ops";
import type { SqlExecutor } from "./ops/sql-types";
import type { SaveEntityInput } from "./ops/types";
import { JsonPlusSerializer } from "./serializer";
import type { Checkpoint, MemoryStore, Session, SessionOptions, StoredMessage } from "./types";

type ForkHandler = (checkpointId: string, options?: { title?: string }) => Promise<Session>;

type AbstractSqlCheckpointStoreOptions = {
  fork?: ForkHandler;
  serializer?: JsonPlusSerializer;
};

export abstract class AbstractSqlCheckpointStore implements MemoryStore {
  readonly hasSemanticSearch = true;

  protected executor: SqlExecutor;
  protected serializer: JsonPlusSerializer;
  private forkHandler: ForkHandler;

  protected constructor(executor: SqlExecutor, options: AbstractSqlCheckpointStoreOptions = {}) {
    this.executor = executor;
    this.serializer = options.serializer ?? new JsonPlusSerializer();
    this.forkHandler =
      options.fork ?? ((checkpointId, opts) => forkFromCheckpoint(this, checkpointId, opts));
  }

  protected async validateSessionExists(sessionId: string): Promise<void> {
    const session = await sqlGetSession(this.executor, this.serializer, sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
  }

  abstract close(): Promise<void>;

  async createSession(directory: string, options: SessionOptions = {}): Promise<Session> {
    return sqlCreateSession(this.executor, this.serializer, directory, options);
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return sqlGetSession(this.executor, this.serializer, sessionId);
  }

  async listSessions(workspaceId?: string): Promise<Array<Session>> {
    return sqlListSessions(this.executor, this.serializer, workspaceId);
  }

  async updateSession(sessionId: string, updates: Partial<Session>): Promise<void> {
    await this.validateSessionExists(sessionId);

    await sqlUpdateSession(this.executor, this.serializer, sessionId, updates);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await sqlDeleteSession(this.executor, sessionId);
  }

  async addMessage(
    sessionId: string,
    message: Omit<StoredMessage, "id" | "createdAt">
  ): Promise<StoredMessage> {
    await this.validateSessionExists(sessionId);

    return sqlAddMessage(this.executor, this.serializer, sessionId, message);
  }

  async getMessages(
    sessionId: string,
    options: { before?: number; limit?: number } = {}
  ): Promise<Array<StoredMessage>> {
    await this.validateSessionExists(sessionId);

    return sqlGetMessages(this.executor, this.serializer, sessionId, options);
  }

  async saveCheckpoint(checkpoint: Omit<Checkpoint, "id" | "createdAt">): Promise<Checkpoint> {
    await this.validateSessionExists(checkpoint.sessionId);

    return sqlSaveCheckpoint(this.executor, this.serializer, checkpoint);
  }

  async getCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
    return sqlGetCheckpoint(this.executor, this.serializer, checkpointId);
  }

  async getLatestCheckpoint(sessionId: string, namespace?: string): Promise<Checkpoint | null> {
    const session = await sqlGetSession(this.executor, this.serializer, sessionId);
    if (!session) {
      return null;
    }

    return sqlGetLatestCheckpoint(this.executor, this.serializer, sessionId, namespace);
  }

  async listCheckpoints(
    sessionId: string,
    options: { limit?: number; namespace?: string } = {}
  ): Promise<Array<Checkpoint>> {
    await this.validateSessionExists(sessionId);

    return sqlListCheckpoints(this.executor, this.serializer, sessionId, options);
  }

  async fork(checkpointId: string, options: { title?: string } = {}): Promise<Session> {
    return this.forkHandler(checkpointId, options);
  }

  async saveEntity(entity: Omit<Entity, "id" | "createdAt" | "updatedAt">): Promise<Entity> {
    const saved = buildEntity(entity);
    const input: SaveEntityInput = {
      ...saved,
      attributes: this.serializer.serialize(saved.attributes),
      embedding: saved.embedding ? JSON.stringify(saved.embedding) : null,
      relationships: this.serializer.serialize(saved.relationships),
    };

    const row = await sqlSaveEntity(this.executor, input);
    return mapEntityRow(this.serializer, row);
  }

  async getEntity(id: string): Promise<Entity | null> {
    const row = await sqlGetEntityById(this.executor, id);
    return row ? mapEntityRow(this.serializer, row) : null;
  }

  async listEntities(options: ListEntitiesOptions): Promise<Array<Entity>> {
    const filters = buildFilterConditions(options);
    const rows = await sqlListEntities(this.executor, filters);
    return rows.map((row) => mapEntityRow(this.serializer, row));
  }

  async updateEntity(id: string, updates: Partial<Entity>): Promise<void> {
    await validateEntityExists(id, () => this.getEntity(id));

    const updateInput: UpdateEntityInput = {
      attributes:
        updates.attributes !== undefined
          ? this.serializer.serialize(updates.attributes)
          : undefined,
      embedding: updates.embedding !== undefined ? JSON.stringify(updates.embedding) : undefined,
      name: updates.name,
      relationships:
        updates.relationships !== undefined
          ? this.serializer.serialize(updates.relationships)
          : undefined,
      type: updates.type,
      updatedAt: Date.now(),
      workspaceId: updates.workspaceId,
    };

    await sqlUpdateEntity(this.executor, id, updateInput);
  }

  async deleteEntity(id: string): Promise<void> {
    await sqlDeleteEntity(this.executor, id);
  }

  async saveFact(fact: Omit<Fact, "id" | "createdAt">): Promise<Fact> {
    return sqlSaveFact(this.executor, this.serializer, fact);
  }

  async getFact(id: string): Promise<Fact | null> {
    return sqlGetFact(this.executor, this.serializer, id);
  }

  async listFacts(options: ListFactsOptions): Promise<Array<Fact>> {
    return sqlListFacts(this.executor, this.serializer, options);
  }

  async deleteFact(id: string): Promise<void> {
    await sqlDeleteFact(this.executor, id);
  }

  async searchEntitiesSemantic(
    embedding: Array<number>,
    options: SemanticSearchOptions = {}
  ): Promise<Array<Entity>> {
    return sqlSearchEntitiesSemantic(this.executor, this.serializer, embedding, options);
  }

  async searchFactsSemantic(
    embedding: Array<number>,
    options: SemanticSearchOptions = {}
  ): Promise<Array<Fact>> {
    return sqlSearchFactsSemantic(this.executor, this.serializer, embedding, options);
  }
}
