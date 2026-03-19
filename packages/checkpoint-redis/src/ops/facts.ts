import type { Fact, ListFactsOptions } from "@obsku/framework";
import {
  buildFact,
  FactSchema,
  JsonPlusSerializer,
} from "@obsku/framework/checkpoint/backend-shared";
import type { RedisClientType } from "redis";
import { getRecord, mGetDeserialize } from "./helpers";
import { factKey, factsByWorkspaceKey } from "./keys";

export async function saveFact(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  fact: Omit<Fact, "id" | "createdAt">
): Promise<Fact> {
  const saved = buildFact(fact);

  await client.set(factKey(prefix, saved.id), serializer.serialize(saved));

  if (saved.workspaceId) {
    await client.zAdd(factsByWorkspaceKey(prefix, saved.workspaceId), {
      score: saved.confidence,
      value: saved.id,
    });
  }

  return saved;
}

export async function getFact(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  id: string
): Promise<Fact | null> {
  return getRecord(
    client,
    serializer,
    FactSchema,
    factKey(prefix, id),
    `Invalid fact payload in Redis for ${id}`
  );
}

export async function listFacts(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  options: ListFactsOptions
): Promise<Array<Fact>> {
  let factIds: Array<string>;

  if (options.workspaceId) {
    const minScore = options.minConfidence ?? 0;
    factIds = await client.zRangeByScore(
      factsByWorkspaceKey(prefix, options.workspaceId),
      minScore,
      1
    );
  } else {
    const keys = await client.keys(`${prefix}fact:*`);
    factIds = keys.map((k) => k.replace(`${prefix}fact:`, ""));

    if (options.minConfidence !== undefined) {
      const factKeysToFetch = factIds.map((id) => factKey(prefix, id));
      const allFacts = await mGetDeserialize(
        client,
        serializer,
        FactSchema,
        factKeysToFetch,
        "Invalid fact payload in Redis list"
      );
      const minConf = options.minConfidence;
      const facts = allFacts.filter((f) => f.confidence >= minConf);
      if (options.limit && options.limit > 0) {
        return facts.slice(0, options.limit);
      }
      return facts;
    }
  }

  if (options.limit && options.limit > 0) {
    factIds = factIds.slice(0, options.limit);
  }

  const factKeys = factIds.map((id) => factKey(prefix, id));
  return mGetDeserialize(
    client,
    serializer,
    FactSchema,
    factKeys,
    "Invalid fact payload in Redis list"
  );
}

export async function deleteFact(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  id: string
): Promise<void> {
  const existing = await getFact(client, serializer, prefix, id);
  if (!existing) {
    return;
  }

  await client.del(factKey(prefix, id));
  if (existing.workspaceId) {
    await client.zRem(factsByWorkspaceKey(prefix, existing.workspaceId), id);
  }
}
