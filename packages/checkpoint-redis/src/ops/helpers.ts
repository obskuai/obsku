import { DEFAULTS, formatError, telemetryLog } from "@obsku/framework";
import { type JsonPlusSerializer, validate } from "@obsku/framework/checkpoint/backend-shared";
import type { RedisClientType } from "redis";
import { SCAN_CHUNK_SIZE } from "../constants";

type SchemaType<T> = Parameters<typeof validate<T>>[0];

export function safeDeserialize<T>(
  serializer: JsonPlusSerializer,
  schema: SchemaType<T>,
  serializedValue: string,
  errorMessage: string,
  key?: string
): T | null {
  try {
    const parsed = serializer.deserialize(serializedValue);
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const preview =
        serializedValue.length > DEFAULTS.preview.redisLogPreviewLength
          ? `${serializedValue.slice(0, DEFAULTS.preview.redisLogPreviewLength)}…`
          : serializedValue;
      telemetryLog(
        `${errorMessage} key=${key ?? "unknown"} error=${result.error.message} data=${preview}`
      );
      return null;
    }
    return result.data;
  } catch (error) {
    const preview =
      serializedValue.length > DEFAULTS.preview.redisLogPreviewLength
        ? `${serializedValue.slice(0, DEFAULTS.preview.redisLogPreviewLength)}…`
        : serializedValue;
    const errorText = formatError(error);
    telemetryLog(`${errorMessage} key=${key ?? "unknown"} error=${errorText} data=${preview}`);
    return null;
  }
}

export async function mGetDeserialize<T>(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  schema: SchemaType<T>,
  keys: Array<string>,
  errorMessage: string
): Promise<Array<T>> {
  const results: Array<T> = [];
  for (let i = 0; i < keys.length; i += SCAN_CHUNK_SIZE) {
    const chunk = await client.mGet(keys.slice(i, i + SCAN_CHUNK_SIZE));
    for (const serialized of chunk.filter((data): data is string => data !== null)) {
      const item = safeDeserialize(serializer, schema, serialized, errorMessage);
      if (item) {
        results.push(item);
      }
    }
  }
  return results;
}

export async function getRecord<T>(
  client: RedisClientType,
  serializer: JsonPlusSerializer,
  schema: SchemaType<T>,
  key: string,
  errorMessage: string
): Promise<T | null> {
  const raw = await client.get(key);
  if (!raw) return null;
  return safeDeserialize(serializer, schema, raw, errorMessage, key);
}
