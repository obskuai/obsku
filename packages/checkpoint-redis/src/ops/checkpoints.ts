import crypto from "node:crypto";
import type { Checkpoint } from "@obsku/framework";
import { CheckpointSchema, JsonPlusSerializer } from "@obsku/framework/checkpoint/backend-shared";
import type { RedisClientType } from "redis";
import { SCAN_CHUNK_SIZE } from "../constants";
import { getRecord, mGetDeserialize } from "./helpers";
import { checkpointKey, checkpointsIndexKey, versionsIndexKey } from "./keys";
import { getSession, requireSession } from "./sessions";

export async function saveCheckpoint(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  checkpoint: Omit<Checkpoint, "id" | "createdAt">
): Promise<Checkpoint> {
  await requireSession(client, serializer, prefix, checkpoint.sessionId);

  const now = Date.now();
  const fullCheckpoint: Checkpoint = {
    ...checkpoint,
    createdAt: now,
    id: crypto.randomUUID(),
  };

  await client.set(checkpointKey(prefix, fullCheckpoint.id), serializer.serialize(fullCheckpoint));

  await client.zAdd(checkpointsIndexKey(prefix, checkpoint.sessionId, checkpoint.namespace), {
    score: now,
    value: fullCheckpoint.id,
  });

  await client.hSet(
    versionsIndexKey(prefix, checkpoint.sessionId, checkpoint.namespace),
    checkpoint.version.toString(),
    fullCheckpoint.id
  );

  return fullCheckpoint;
}

export async function getCheckpoint(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  checkpointId: string
): Promise<Checkpoint | null> {
  return getRecord(
    client,
    serializer,
    CheckpointSchema,
    checkpointKey(prefix, checkpointId),
    `Invalid checkpoint payload in Redis for ${checkpointId}`
  );
}

/**
 * Scan all checkpoint index keys for a session and collect IDs via zRange.
 * start/stop are the zRange bounds (e.g. -1,-1 for latest; 0,-1 for all).
 */
async function gatherIdsFromScan(
  client: RedisClientType,
  prefix: string,
  sessionId: string,
  start: number,
  stop: number
): Promise<Array<string>> {
  const pattern = `${prefix}checkpoints:${sessionId}:*`;
  const ids: Array<string> = [];
  for await (const key of client.scanIterator({ COUNT: SCAN_CHUNK_SIZE, MATCH: pattern })) {
    const rangeIds = await client.zRange(key, start, stop);
    ids.push(...rangeIds);
  }
  return ids;
}

export async function getLatestCheckpoint(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  sessionId: string,
  namespace?: string
): Promise<Checkpoint | null> {
  const session = await getSession(client, serializer, prefix, sessionId);
  if (!session) {
    return null;
  }

  if (namespace) {
    const ids = await client.zRange(checkpointsIndexKey(prefix, sessionId, namespace), -1, -1);

    if (ids.length === 0) {
      return null;
    }
    return getCheckpoint(client, serializer, prefix, ids[0]);
  }

  // Collect the latest ID per namespace, then bulk-fetch and find overall latest.
  const latestIds = await gatherIdsFromScan(client, prefix, sessionId, -1, -1);
  if (latestIds.length === 0) {
    return null;
  }
  const candidates = await mGetDeserialize(
    client,
    serializer,
    CheckpointSchema,
    latestIds.map((id) => checkpointKey(prefix, id)),
    "Invalid checkpoint payload in Redis"
  );
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((best, cp) => (cp.createdAt > best.createdAt ? cp : best));
}

export async function listCheckpoints(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  sessionId: string,
  options: { limit?: number; namespace?: string } = {}
): Promise<Array<Checkpoint>> {
  await requireSession(client, serializer, prefix, sessionId);

  if (options.namespace) {
    const ids = await client.zRange(
      checkpointsIndexKey(prefix, sessionId, options.namespace),
      0,
      -1,
      { REV: true }
    );

    const limitedIds = options.limit ? ids.slice(0, options.limit) : ids;
    return mGetDeserialize(
      client,
      serializer,
      CheckpointSchema,
      limitedIds.map((id) => checkpointKey(prefix, id)),
      "Invalid checkpoint payload in Redis"
    );
  }

  // Collect all IDs across namespaces, bulk-fetch, sort newest-first, then limit.
  const allIds = await gatherIdsFromScan(client, prefix, sessionId, 0, -1);
  const checkpoints = await mGetDeserialize(
    client,
    serializer,
    CheckpointSchema,
    allIds.map((id) => checkpointKey(prefix, id)),
    "Invalid checkpoint payload in Redis"
  );

  checkpoints.sort((a, b) => b.createdAt - a.createdAt);

  if (options.limit) {
    checkpoints.splice(options.limit);
  }

  return checkpoints;
}
