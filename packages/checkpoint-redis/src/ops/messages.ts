import type { StoredMessage } from "@obsku/framework";
import { isRecord } from "@obsku/framework";
import { JsonPlusSerializer, parseStoredMessage } from "@obsku/framework/checkpoint/backend-shared";

import type { RedisClientType } from "redis";
import { messageCounterKey, messagesKey } from "./keys";
import { requireSession, updateSession } from "./sessions";

const isRuntimeToolCall = (value: unknown): boolean =>
  isRecord(value) &&
  isRecord(value.input) &&
  typeof value.name === "string" &&
  typeof value.toolUseId === "string";

const isStoredToolResult = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.content === "string" &&
  typeof value.toolUseId === "string" &&
  (value.fullOutputRef === undefined || typeof value.fullOutputRef === "string") &&
  (value.status === undefined || typeof value.status === "string");

const isRuntimeStoredMessage = (value: unknown): value is StoredMessage =>
  isRecord(value) &&
  typeof value.createdAt === "number" &&
  typeof value.id === "number" &&
  typeof value.role === "string" &&
  typeof value.sessionId === "string" &&
  (value.content === undefined || typeof value.content === "string") &&
  (value.tokensIn === undefined || typeof value.tokensIn === "number") &&
  (value.tokensOut === undefined || typeof value.tokensOut === "number") &&
  (value.toolCalls === undefined ||
    (Array.isArray(value.toolCalls) && value.toolCalls.every(isRuntimeToolCall))) &&
  (value.toolResults === undefined ||
    (Array.isArray(value.toolResults) && value.toolResults.every(isStoredToolResult)));

const asRuntimeStoredMessage = (value: unknown): StoredMessage | null =>
  isRuntimeStoredMessage(value) ? value : null;

export async function addMessage(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  sessionId: string,
  message: Omit<StoredMessage, "id" | "createdAt">
): Promise<StoredMessage> {
  await requireSession(client, serializer, prefix, sessionId);

  const now = Date.now();
  const id = await client.incr(messageCounterKey(prefix, sessionId));

  const fullMessage: StoredMessage = {
    ...message,
    createdAt: now,
    id,
    sessionId,
  };

  await client.zAdd(messagesKey(prefix, sessionId), {
    score: now,
    value: serializer.serialize(fullMessage),
  });

  await updateSession(client, serializer, prefix, sessionId, {});

  return fullMessage;
}

export async function getMessages(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  prefix: string,
  sessionId: string,
  options: { before?: number; limit?: number } = {}
): Promise<Array<StoredMessage>> {
  await requireSession(client, serializer, prefix, sessionId);

  let serializedMessages: Array<string>;

  if (options.before !== undefined) {
    serializedMessages = await client.zRangeByScore(
      messagesKey(prefix, sessionId),
      0,
      options.before - 1,
      options.limit ? { LIMIT: { count: options.limit, offset: 0 } } : undefined
    );
  } else {
    serializedMessages = await client.zRange(messagesKey(prefix, sessionId), 0, -1);

    if (options.limit !== undefined && serializedMessages.length > options.limit) {
      serializedMessages = serializedMessages.slice(-options.limit);
    }
  }

  const messages: Array<StoredMessage> = [];
  for (const serializedMessage of serializedMessages) {
    const raw = serializer.deserialize(serializedMessage);
    const runtimeMessage = asRuntimeStoredMessage(raw);
    if (runtimeMessage) {
      messages.push(runtimeMessage);
      continue;
    }
    const message = parseStoredMessage(raw);
    if (message) {
      messages.push(message);
    }
  }
  return messages;
}
