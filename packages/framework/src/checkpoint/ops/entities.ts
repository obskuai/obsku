import type { Entity, ListEntitiesOptions, Relationship } from "../../memory/index";
import { buildEntity, buildFilterConditions, validateEntityExists } from "./shared-helpers";
import type { InMemoryState } from "./types";

/** Create a defensive shallow copy of an entity with nested structures cloned */
function copyEntity(entity: Entity): Entity {
  return {
    ...entity,
    attributes: { ...entity.attributes },
    relationships: entity.relationships.map((r: Relationship) => ({ ...r })),
    ...(entity.embedding && { embedding: [...entity.embedding] }),
  };
}

export function saveEntity(
  state: InMemoryState,
  entity: Omit<Entity, "id" | "createdAt" | "updatedAt">
): Entity {
  const fullEntity = buildEntity(entity);

  state.entities.set(fullEntity.id, fullEntity);
  return copyEntity(fullEntity);
}

export function getEntity(state: InMemoryState, id: string): Entity | null {
  const entity = state.entities.get(id);
  return entity ? copyEntity(entity) : null;
}

export function listEntities(state: InMemoryState, options: ListEntitiesOptions): Array<Entity> {
  let results = Array.from(state.entities.values());

  const { filters, limit } = buildFilterConditions(options);
  for (const filter of filters) {
    if (filter.key === "sessionId") {
      results = results.filter((e) => e.sessionId === filter.value);
    } else if (filter.key === "workspaceId") {
      results = results.filter((e) => e.workspaceId === filter.value);
    } else {
      results = results.filter((e) => e.type === filter.value);
    }
  }
  if (limit && limit > 0) {
    results = results.slice(0, limit);
  }

  return results.map(copyEntity);
}

export function updateEntity(state: InMemoryState, id: string, updates: Partial<Entity>): void {
  const entity = validateEntityExists(id, () => state.entities.get(id) ?? null);

  Object.assign(entity, updates, { updatedAt: Date.now() });
}

export function deleteEntity(state: InMemoryState, id: string): void {
  state.entities.delete(id);
}
