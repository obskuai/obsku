import { DEFAULTS } from "../../defaults";
import { getErrorMessage } from "../../error-utils";
import { debugLog } from "../../telemetry/log";
import type { JsonPlusSerializer } from "../serializer";
import { deserializeEmbedding } from "../similarity";
import {
  invalidFieldType,
  isNullish,
  isRecord,
  requireNumberValue,
  requireRecordValue,
  requireStringValue,
} from "./value-validators";

type ValueParser<T> = (value: unknown, field: string) => T;

const asValueParser = <T>(parser: (value: unknown, field: string) => T): ValueParser<T> => parser;

const parseDeserializedValue = <T>(
  serializer: JsonPlusSerializer,
  value: unknown,
  field: string,
  parser: ValueParser<T>
): T => {
  const parsed = typeof value === "string" ? serializer.deserialize(value) : value;
  return parser(parsed, field);
};

const parseValueFromFallback = <T>(fallback: T, field: string): ValueParser<T> => {
  // Type discriminators and their corresponding parsers, in priority order
  // (more specific types like Buffer/Date/Map/Set must come before generic isRecord)
  const typeHandlers: Array<{
    test: (v: unknown) => boolean;
    createParser: (fieldName: string) => ValueParser<unknown>;
  }> = [
    {
      test: Array.isArray,
      createParser: (fieldName) => (value) => {
        if (!Array.isArray(value)) {
          throw invalidFieldType(fieldName, "an array", value);
        }
        return value as unknown[];
      },
    },
    {
      test: Buffer.isBuffer,
      createParser: (fieldName) => (value) => {
        if (!Buffer.isBuffer(value)) {
          throw invalidFieldType(fieldName, "a Buffer", value);
        }
        return value as Buffer;
      },
    },
    {
      test: (v): v is Date => v instanceof Date,
      createParser: (fieldName) => (value) => {
        if (!(value instanceof Date)) {
          throw invalidFieldType(fieldName, "a Date", value);
        }
        return value as Date;
      },
    },
    {
      test: (v): v is Map<unknown, unknown> => v instanceof Map,
      createParser: (fieldName) => (value) => {
        if (!(value instanceof Map)) {
          throw invalidFieldType(fieldName, "a Map", value);
        }
        return value as Map<unknown, unknown>;
      },
    },
    {
      test: (v): v is Set<unknown> => v instanceof Set,
      createParser: (fieldName) => (value) => {
        if (!(value instanceof Set)) {
          throw invalidFieldType(fieldName, "a Set", value);
        }
        return value as Set<unknown>;
      },
    },
    {
      test: isRecord,
      createParser: () => requireRecordValue,
    },
    {
      test: (v): v is string => typeof v === "string",
      createParser: () => requireStringValue,
    },
    {
      test: (v): v is number => typeof v === "number",
      createParser: () => requireNumberValue,
    },
    {
      test: (v): v is boolean => typeof v === "boolean",
      createParser: (fieldName) => (value) => {
        if (typeof value !== "boolean") {
          throw invalidFieldType(fieldName, "a boolean", value);
        }
        return value as boolean;
      },
    },
  ];

  for (const handler of typeHandlers) {
    if (handler.test(fallback)) {
      return asValueParser<T>(handler.createParser(field));
    }
  }

  // Default: passthrough parser for any other type - cast is safe because
  // this is the fallback path when no specific type handler matches, and
  // the deserialized value is expected to match the fallback type T
  return asValueParser<T>((value) => value as T);
};

export const deserializeValue = <T>(
  serializer: JsonPlusSerializer,
  value: string | T | null | undefined,
  fallback: T,
  parser?: ValueParser<T>,
  field = "checkpoint value"
): T => {
  if (isNullish(value)) {
    return fallback;
  }

  if (parser) {
    return parseDeserializedValue<T>(serializer, value, field, parser);
  }

  return parseDeserializedValue<T>(
    serializer,
    value,
    field,
    parseValueFromFallback(fallback, field)
  );
};

export const deserializeOptionalValue = <T>(
  serializer: JsonPlusSerializer,
  value: string | T | null | undefined,
  parser: ValueParser<T>,
  field = "checkpoint value"
): T | undefined => {
  if (isNullish(value)) {
    return undefined;
  }

  return parseDeserializedValue<T>(serializer, value, field, parser);
};

export const deserializeField = <T>(
  value: unknown,
  serializer: JsonPlusSerializer,
  parser: ValueParser<T>,
  field = "checkpoint value"
): T | undefined => {
  if (isNullish(value)) {
    return undefined;
  }

  return parseDeserializedValue<T>(serializer, value, field, parser);
};

export const parseEmbedding = (
  value: string | number[] | Uint8Array | null | undefined
): number[] | undefined => {
  if (isNullish(value)) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = deserializeEmbedding(value);
    return parsed ?? undefined;
  } catch (error: unknown) {
    const preview =
      typeof value === "string"
        ? value.length > DEFAULTS.preview.logPreviewLength
          ? `${value.slice(0, DEFAULTS.preview.logPreviewLength)}...`
          : value
        : "<binary>";
    const errMsg = getErrorMessage(error);
    debugLog(`Failed to parse embedding (${errMsg}): ${preview}`);
    return undefined;
  }
};
