import type {
  Entity,
  Fact,
  ListEntitiesOptions,
  ListFactsOptions,
  SemanticSearchOptions,
} from "../memory/index";
import {
  getCheckpoint,
  getLatestCheckpoint,
  listCheckpoints,
  saveCheckpoint,
} from "./ops/checkpoints";
import { deleteEntity, getEntity, listEntities, saveEntity, updateEntity } from "./ops/entities";
import { deleteFact, getFact, listFacts, saveFact } from "./ops/facts";
import { forkFromCheckpoint } from "./ops/fork";
import { addMessage, getMessages } from "./ops/messages";
import { searchEntitiesSemantic, searchFactsSemantic } from "./ops/search";
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  updateSession,
} from "./ops/sessions";
import type { InMemoryState } from "./ops/types";
import type {
  Checkpoint,
  CheckpointBackend,
  MemoryStore,
  Session,
  SessionOptions,
  StoredMessage,
} from "./types";

export class InMemoryCheckpointStore implements CheckpointBackend, MemoryStore {
  readonly hasSemanticSearch = true;

  private state: InMemoryState = {
    checkpoints: new Map(),
    entities: new Map(),
    facts: new Map(),
    messageCounters: new Map(),
    messages: new Map(),
    sessions: new Map(),
  };

  async createSession(dir: string, opts: SessionOptions = {}): Promise<Session> {
    return createSession(this.state, dir, opts);
  }
  async getSession(id: string): Promise<Session | null> {
    return getSession(this.state, id);
  }
  async listSessions(workspaceId?: string): Promise<Array<Session>> {
    return listSessions(this.state, workspaceId);
  }
  async updateSession(id: string, updates: Partial<Session>): Promise<void> {
    updateSession(this.state, id, updates);
  }
  async deleteSession(id: string): Promise<void> {
    deleteSession(this.state, id);
  }

  async addMessage(
    sessionId: string,
    message: Omit<StoredMessage, "id" | "createdAt">
  ): Promise<StoredMessage> {
    return addMessage(this.state, sessionId, message);
  }
  async getMessages(
    sessionId: string,
    opts: { before?: number; limit?: number } = {}
  ): Promise<Array<StoredMessage>> {
    return getMessages(this.state, sessionId, opts);
  }

  async saveCheckpoint(cp: Omit<Checkpoint, "id" | "createdAt">): Promise<Checkpoint> {
    return saveCheckpoint(this.state, cp);
  }
  async getCheckpoint(id: string): Promise<Checkpoint | null> {
    return getCheckpoint(this.state, id);
  }
  async getLatestCheckpoint(sessionId: string, ns?: string): Promise<Checkpoint | null> {
    return getLatestCheckpoint(this.state, sessionId, ns);
  }
  async listCheckpoints(
    sessionId: string,
    opts: { limit?: number; namespace?: string } = {}
  ): Promise<Array<Checkpoint>> {
    return listCheckpoints(this.state, sessionId, opts);
  }

  async fork(checkpointId: string, options: { title?: string } = {}): Promise<Session> {
    return forkFromCheckpoint(this, checkpointId, options);
  }

  async saveEntity(entity: Omit<Entity, "id" | "createdAt" | "updatedAt">): Promise<Entity> {
    return saveEntity(this.state, entity);
  }
  async getEntity(id: string): Promise<Entity | null> {
    return getEntity(this.state, id);
  }
  async listEntities(opts: ListEntitiesOptions): Promise<Array<Entity>> {
    return listEntities(this.state, opts);
  }
  async updateEntity(id: string, updates: Partial<Entity>): Promise<void> {
    updateEntity(this.state, id, updates);
  }
  async deleteEntity(id: string): Promise<void> {
    deleteEntity(this.state, id);
  }

  async saveFact(fact: Omit<Fact, "id" | "createdAt">): Promise<Fact> {
    return saveFact(this.state, fact);
  }
  async getFact(id: string): Promise<Fact | null> {
    return getFact(this.state, id);
  }
  async listFacts(opts: ListFactsOptions): Promise<Array<Fact>> {
    return listFacts(this.state, opts);
  }
  async deleteFact(id: string): Promise<void> {
    deleteFact(this.state, id);
  }

  async searchEntitiesSemantic(
    embedding: Array<number>,
    opts: SemanticSearchOptions = {}
  ): Promise<Array<Entity>> {
    return searchEntitiesSemantic(this.state.entities, embedding, opts);
  }
  async searchFactsSemantic(
    embedding: Array<number>,
    opts: SemanticSearchOptions = {}
  ): Promise<Array<Fact>> {
    return searchFactsSemantic(this.state.facts, embedding, opts);
  }

  async close(): Promise<void> {
    this.state.sessions.clear();
    this.state.messages.clear();
    this.state.checkpoints.clear();
    this.state.messageCounters.clear();
    this.state.entities.clear();
    this.state.facts.clear();
  }
}
