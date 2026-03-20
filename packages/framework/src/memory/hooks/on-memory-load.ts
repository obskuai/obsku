import { DEFAULTS } from "../../defaults";
import type { MemoryConfig } from "../../types";
import type { Entity, Fact, MemoryHookContext, MemoryInjection } from "../types";
import { buildContextString } from "../utils";

type LoadConfig = Pick<
  MemoryConfig,
  "maxEntitiesPerSession" | "maxFactsToInject" | "maxContextLength"
>;

/**
 * Default memory load hook. Loads entities and facts from store, builds context string.
 * Uses semantic search if embeddingProvider is configured and input query is provided.
 */
export async function defaultOnMemoryLoad(
  ctx: MemoryHookContext,
  config: LoadConfig = {}
): Promise<MemoryInjection> {
  const maxEntities = config.maxEntitiesPerSession ?? DEFAULTS.memory.maxEntitiesPerSession;
  const maxFacts = config.maxFactsToInject ?? DEFAULTS.memory.maxFactsToInject;
  const maxLength = config.maxContextLength ?? DEFAULTS.memory.maxContextLength;

  // Compute query embedding once and reuse across entity/fact queries
  const queryEmbedding =
    ctx.store.hasSemanticSearch && ctx.embeddingProvider && ctx.input
      ? await ctx.embeddingProvider.embed(ctx.input)
      : undefined;

  const [entities, facts] = await Promise.all([
    loadEntities(ctx, maxEntities, queryEmbedding),
    loadFacts(ctx, maxFacts, queryEmbedding),
  ]);

  const context = buildContextString(entities, facts, maxLength);

  return {
    context: context || undefined,
    entities,
    facts,
  };
}

async function loadEntities(
  ctx: MemoryHookContext,
  limit: number,
  queryEmbedding: Array<number> | undefined
): Promise<Array<Entity>> {
  if (queryEmbedding) {
    const semanticEntities = await ctx.store.searchEntitiesSemantic(queryEmbedding, {
      sessionId: ctx.sessionId,
      threshold: DEFAULTS.memory.semanticSearchThreshold,
      topK: limit,
      workspaceId: ctx.workspaceId,
    });

    if (semanticEntities.length > 0) {
      return semanticEntities;
    }
  }

  const sessionEntities = await ctx.store.listEntities({
    limit,
    sessionId: ctx.sessionId,
  });

  if (ctx.workspaceId && sessionEntities.length < limit) {
    const workspaceEntities = await ctx.store.listEntities({
      limit: limit - sessionEntities.length,
      workspaceId: ctx.workspaceId,
    });

    const sessionIds = new Set(sessionEntities.map((e: Entity) => e.id));
    const additional = workspaceEntities.filter((e: Entity) => !sessionIds.has(e.id));
    return [...sessionEntities, ...additional];
  }

  return sessionEntities;
}

async function loadFacts(
  ctx: MemoryHookContext,
  limit: number,
  queryEmbedding: Array<number> | undefined
): Promise<Array<Fact>> {
  if (!ctx.workspaceId) {
    return [];
  }

  if (queryEmbedding) {
    const semanticFacts = await ctx.store.searchFactsSemantic(queryEmbedding, {
      threshold: DEFAULTS.memory.semanticSearchThreshold,
      topK: limit,
      workspaceId: ctx.workspaceId,
    });

    if (semanticFacts.length > 0) {
      return semanticFacts;
    }
  }

  return ctx.store.listFacts({
    limit,
    minConfidence: DEFAULTS.memory.minFactConfidence,
    workspaceId: ctx.workspaceId,
  });
}
