import type { Session, SessionOptions } from "@obsku/framework";
import {
  buildSession,
  JsonPlusSerializer,
  SessionNotFoundError,
  SessionSchema,
} from "@obsku/framework/checkpoint/backend-shared";
import type { RedisClientType } from "redis";
import { SCAN_CHUNK_SIZE } from "../constants";
import { getRecord, safeDeserialize } from "./helpers";
import { checkpointKey, messageCounterKey, messagesKey, sessionKey } from "./keys";

export async function createSession(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  directory: string,
  options: SessionOptions = {}
): Promise<Session> {
  const session = buildSession(directory, options);

  await client.set(sessionKey(prefix, session.id), serializer.serialize(session));

  return session;
}

export async function getSession(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  sessionId: string
): Promise<Session | null> {
  return getRecord(
    client,
    serializer,
    SessionSchema,
    sessionKey(prefix, sessionId),
    `Invalid session payload in Redis for ${sessionId}`
  );
}

export async function requireSession(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  sessionId: string
): Promise<Session> {
  const session = await getSession(client, serializer, prefix, sessionId);
  if (!session) {
    throw new SessionNotFoundError(sessionId);
  }
  return session;
}

export async function listSessions(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  workspaceId?: string
): Promise<Array<Session>> {
  const sessions: Array<Session> = [];
  const pattern = `${prefix}session:*`;

  for await (const key of client.scanIterator({ COUNT: SCAN_CHUNK_SIZE, MATCH: pattern })) {
    const serializedSession = await client.get(key);
    if (serializedSession) {
      const session = safeDeserialize(
        serializer,
        SessionSchema,
        serializedSession,
        "Invalid session payload in Redis list",
        key
      );
      if (session && (!workspaceId || session.workspaceId === workspaceId)) {
        sessions.push(session);
      }
    }
  }

  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function updateSession(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  sessionId: string,
  updates: Partial<Session>
): Promise<void> {
  const session = await requireSession(client, serializer, prefix, sessionId);

  const now = Date.now();
  const updated: Session = {
    ...session,
    ...updates,
    createdAt: session.createdAt,
    id: session.id,
    updatedAt: now,
  };

  await client.set(sessionKey(prefix, sessionId), serializer.serialize(updated));
}

export async function deleteSession(
  client: RedisClientType,
  prefix: string,
  sessionId: string
): Promise<void> {
  await client.del(sessionKey(prefix, sessionId));
  await client.del(messagesKey(prefix, sessionId));
  await client.del(messageCounterKey(prefix, sessionId));

  const checkpointPattern = `${prefix}checkpoints:${sessionId}:*`;
  const versionPattern = `${prefix}versions:${sessionId}:*`;

  const checkpointIds: Array<string> = [];
  for await (const key of client.scanIterator({
    COUNT: SCAN_CHUNK_SIZE,
    MATCH: checkpointPattern,
  })) {
    const ids = await client.zRange(key, 0, -1);
    checkpointIds.push(...ids);
    await client.del(key);
  }

  for await (const key of client.scanIterator({ COUNT: SCAN_CHUNK_SIZE, MATCH: versionPattern })) {
    await client.del(key);
  }

  for (const cpId of checkpointIds) {
    await client.del(checkpointKey(prefix, cpId));
  }
}
