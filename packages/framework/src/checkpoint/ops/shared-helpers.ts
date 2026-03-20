import crypto from "node:crypto";
import type { Entity, Fact, ListEntitiesOptions } from "../../memory/index";
import type { JsonPlusSerializer } from "../serializer";
import type { Session, SessionOptions } from "../types";
import { EntityNotFoundError } from "../errors";

export type EntityFilterCondition = {
  key: "sessionId" | "workspaceId" | "type";
  value: string;
};

export type EntityFilterConditions = {
  filters: Array<EntityFilterCondition>;
  limit?: number;
};

const isPromiseLike = <T>(value: T | Promise<T>): value is Promise<T> =>
  typeof value === "object" && value !== null && "then" in value;

export function buildCheckpointRecord<T extends Record<string, unknown>>(
  fields: T,
  id: string,
  createdAt: number
): T & { id: string; createdAt: number } {
  return {
    ...fields,
    id,
    createdAt,
  };
}

export function buildEntity(entity: Omit<Entity, "id" | "createdAt" | "updatedAt">): Entity {
  const now = Date.now();
  const id = crypto.randomUUID();
  return {
    ...buildCheckpointRecord(entity, id, now),
    updatedAt: now,
  };
}

export function buildSession(directory: string, options: SessionOptions): Session {
  const now = Date.now();
  const id = crypto.randomUUID();
  return {
    ...buildCheckpointRecord(
      {
        directory,
        metadata: options.metadata,
        title: options.title,
        workspaceId: options.workspaceId,
      },
      id,
      now
    ),
    updatedAt: now,
  };
}

export function buildFact(fact: Omit<Fact, "id" | "createdAt">): Fact {
  const now = Date.now();
  const id = crypto.randomUUID();
  return buildCheckpointRecord(fact, id, now);
}

export function buildFilterConditions(options: ListEntitiesOptions): EntityFilterConditions {
  const filters: Array<EntityFilterCondition> = [];

  if (options.sessionId) {
    filters.push({ key: "sessionId", value: options.sessionId });
  }
  if (options.workspaceId) {
    filters.push({ key: "workspaceId", value: options.workspaceId });
  }
  if (options.type) {
    filters.push({ key: "type", value: options.type });
  }

  return { filters, limit: options.limit };
}

export function validateEntityExists<T>(id: string, getter: () => T | null): T;
export function validateEntityExists<T>(id: string, getter: () => Promise<T | null>): Promise<T>;
export function validateEntityExists<T>(id: string, getter: () => T | null | Promise<T | null>) {
  const result = getter();
  if (isPromiseLike(result)) {
    return result.then((value) => {
      if (!value) {
        throw new EntityNotFoundError(id);
      }
      return value;
    });
  }

  if (!result) {
    throw new EntityNotFoundError(id);
  }
  return result;
}

export function mapRows<T, R = unknown>(
  rows: R[],
  serializer: JsonPlusSerializer,
  mapper: (s: JsonPlusSerializer, row: R) => T
): T[] {
  return rows.map((row) => mapper(serializer, row));
}
