import type { Entity, ListEntitiesOptions } from "@obsku/framework";
import {
  buildEntity,
  buildFilterConditions,
  EntitySchema,
  JsonPlusSerializer,
  validateEntityExists,
} from "@obsku/framework/checkpoint/backend-shared";
import type { RedisClientType } from "redis";
import { getRecord, mGetDeserialize } from "./helpers";
import { entitiesBySessionKey, entitiesByTypeKey, entitiesByWorkspaceKey, entityKey } from "./keys";

export async function saveEntity(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  entity: Omit<Entity, "id" | "createdAt" | "updatedAt">
): Promise<Entity> {
  const saved = buildEntity(entity);

  await client.set(entityKey(prefix, saved.id), serializer.serialize(saved));

  await client.sAdd(entitiesBySessionKey(prefix, saved.sessionId), saved.id);
  if (saved.workspaceId) {
    await client.sAdd(entitiesByWorkspaceKey(prefix, saved.workspaceId), saved.id);
  }
  await client.sAdd(entitiesByTypeKey(prefix, saved.type), saved.id);

  return saved;
}

export async function getEntity(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  id: string
): Promise<Entity | null> {
  return getRecord(
    client,
    serializer,
    EntitySchema,
    entityKey(prefix, id),
    `Invalid entity payload in Redis for ${id}`
  );
}

export async function listEntities(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  options: ListEntitiesOptions
): Promise<Array<Entity>> {
  const { filters, limit } = buildFilterConditions(options);
  const setKeys: Array<string> = [];
  for (const filter of filters) {
    if (filter.key === "sessionId") {
      setKeys.push(entitiesBySessionKey(prefix, filter.value));
    } else if (filter.key === "workspaceId") {
      setKeys.push(entitiesByWorkspaceKey(prefix, filter.value));
    } else {
      setKeys.push(entitiesByTypeKey(prefix, filter.value));
    }
  }

  let entityIds: Array<string>;
  if (setKeys.length === 0) {
    const keys = await client.keys(`${prefix}entity:*`);
    entityIds = keys.map((k) => k.replace(`${prefix}entity:`, ""));
  } else if (setKeys.length === 1) {
    entityIds = await client.sMembers(setKeys[0]);
  } else {
    entityIds = await client.sInter(setKeys);
  }

  if (limit && limit > 0) {
    entityIds = entityIds.slice(0, limit);
  }

  const entityKeysArr = entityIds.map((id) => entityKey(prefix, id));
  return mGetDeserialize(
    client,
    serializer,
    EntitySchema,
    entityKeysArr,
    "Invalid entity payload in Redis list"
  );
}

export async function updateEntity(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  id: string,
  updates: Partial<Entity>
): Promise<void> {
  const existing = await validateEntityExists<Entity>(id, () =>
    getEntity(client, serializer, prefix, id)
  );

  const oldWorkspaceId = existing.workspaceId;
  const oldType = existing.type;

  const updated: Entity = {
    ...existing,
    ...updates,
    createdAt: existing.createdAt,
    id: existing.id,
    updatedAt: Date.now(),
  };

  await client.set(entityKey(prefix, id), serializer.serialize(updated));

  if (oldWorkspaceId !== updated.workspaceId) {
    if (oldWorkspaceId) {
      await client.sRem(entitiesByWorkspaceKey(prefix, oldWorkspaceId), id);
    }
    if (updated.workspaceId) {
      await client.sAdd(entitiesByWorkspaceKey(prefix, updated.workspaceId), id);
    }
  }

  if (oldType !== updated.type) {
    await client.sRem(entitiesByTypeKey(prefix, oldType), id);
    await client.sAdd(entitiesByTypeKey(prefix, updated.type), id);
  }
}

export async function deleteEntity(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  id: string
): Promise<void> {
  const existing = await getEntity(client, serializer, prefix, id);
  if (!existing) {
    return;
  }

  await client.del(entityKey(prefix, id));
  await client.sRem(entitiesBySessionKey(prefix, existing.sessionId), id);
  if (existing.workspaceId) {
    await client.sRem(entitiesByWorkspaceKey(prefix, existing.workspaceId), id);
  }
  await client.sRem(entitiesByTypeKey(prefix, existing.type), id);
}
