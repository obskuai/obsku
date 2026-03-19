import type { Entity, Fact } from "../../memory/index";
import type { Checkpoint, Session, StoredMessage } from "../types";

export interface InMemoryState {
  checkpoints: Map<string, Checkpoint>;
  entities: Map<string, Entity>;
  facts: Map<string, Fact>;
  messageCounters: Map<string, number>;
  messages: Map<string, Array<StoredMessage>>;
  sessions: Map<string, Session>;
}

export type SaveEntityInput = Omit<Entity, "id" | "createdAt" | "updatedAt" | "attributes" | "embedding" | "relationships"> & {
  attributes: string;
  createdAt: number;
  embedding?: string | null;
  id: string;
  relationships: string;
  updatedAt: number;
  workspaceId?: string | null;
};

export type EntityRow = {
  attributes: string;
  createdAt: number;
  embedding?: string | null;
  id: string;
  name: string;
  relationships: string;
  sessionId: string;
  type: string;
  updatedAt: number;
  workspaceId: string | null;
};
