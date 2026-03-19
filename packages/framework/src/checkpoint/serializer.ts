import { isRecord } from "../utils/type-guards";
import { CheckpointCorruptionError } from "./errors";
import type { Serializer } from "./types";

const SERIALIZER_TYPE = { BUFFER: "Buffer", DATE: "Date", MAP: "Map", SET: "Set" } as const;
type SerializerType = (typeof SERIALIZER_TYPE)[keyof typeof SERIALIZER_TYPE];

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isDate(v: unknown): v is Date {
  return Object.prototype.toString.call(v) === "[object Date]";
}
function isMap(v: unknown): v is Map<unknown, unknown> {
  return Object.prototype.toString.call(v) === "[object Map]";
}
function isSet(v: unknown): v is Set<unknown> {
  return Object.prototype.toString.call(v) === "[object Set]";
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isSerializerType(value: unknown): value is SerializerType {
  return Object.values(SERIALIZER_TYPE).includes(value as SerializerType);
}

function isValidBase64(value: string): boolean {
  return value === "" || BASE64_PATTERN.test(value);
}

function appendPath(path: string, key: string | number): string {
  return typeof key === "number" ? `${path}[${key}]` : `${path}.${key}`;
}

export class JsonPlusSerializer implements Serializer {
  serialize(value: unknown): string {
    return JSON.stringify(this.serializeValue(value));
  }

  private serializeValue(value: unknown): unknown {
    if (isDate(value)) {
      return { __type: SERIALIZER_TYPE.DATE, value: value.toISOString() };
    }
    if (isMap(value)) {
      return {
        __type: SERIALIZER_TYPE.MAP,
        value: [...value].map(([k, v]) => [k, this.serializeValue(v)]),
      };
    }
    if (isSet(value)) {
      return { __type: SERIALIZER_TYPE.SET, value: [...value].map((v) => this.serializeValue(v)) };
    }
    if (Buffer.isBuffer(value)) {
      return { __type: SERIALIZER_TYPE.BUFFER, value: value.toString("base64") };
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.serializeValue(v));
    }
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.serializeValue(v);
      }
      return result;
    }
    return value;
  }

  deserialize(data: string): unknown {
    try {
      return this.deserializeValue(JSON.parse(data));
    } catch (error: unknown) {
      throw new CheckpointCorruptionError(data, error);
    }
  }

  private deserializeValue(value: unknown, path = "$"): unknown {
    if (value === null || typeof value !== "object") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((entry, index) => this.deserializeValue(entry, appendPath(path, index)));
    }

    if (!isRecord(value)) {
      throw new TypeError(`Invalid checkpoint value at ${path}: expected object-compatible value`);
    }

    if (hasOwn(value, "__type")) {
      return this.deserializeTaggedValue(value, path);
    }

    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = this.deserializeValue(v, appendPath(path, k));
    }
    return result;
  }

  private deserializeTaggedValue(obj: Record<string, unknown>, path: string): unknown {
    if (typeof obj.__type !== "string") {
      throw new TypeError(`Invalid tagged checkpoint value at ${path}: __type must be a string`);
    }

    if (!isSerializerType(obj.__type)) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = this.deserializeValue(v, appendPath(path, k));
      }
      return result;
    }

    if (!hasOwn(obj, "value")) {
      throw new TypeError(`Invalid tagged checkpoint value at ${path}: missing value field`);
    }

    if (obj.__type === SERIALIZER_TYPE.DATE) {
      if (typeof obj.value !== "string") {
        throw new TypeError(`Invalid Date checkpoint value at ${path}: value must be a string`);
      }
      const date = new Date(obj.value);
      if (Number.isNaN(date.getTime())) {
        throw new TypeError(`Invalid Date checkpoint value at ${path}: value is not a valid date`);
      }
      return date;
    }

    if (obj.__type === SERIALIZER_TYPE.MAP) {
      if (!Array.isArray(obj.value)) {
        throw new TypeError(`Invalid Map checkpoint value at ${path}: value must be an array`);
      }
      return new Map(
        obj.value.map((entry, index) => {
          if (!Array.isArray(entry) || entry.length !== 2) {
            throw new TypeError(
              `Invalid Map checkpoint entry at ${appendPath(path, "value")}[${index}]`
            );
          }
          const [key, nestedValue] = entry;
          return [
            key,
            this.deserializeValue(nestedValue, `${appendPath(path, "value")}[${index}][1]`),
          ] as const;
        })
      );
    }

    if (obj.__type === SERIALIZER_TYPE.SET) {
      if (!Array.isArray(obj.value)) {
        throw new TypeError(`Invalid Set checkpoint value at ${path}: value must be an array`);
      }
      return new Set(
        obj.value.map((entry, index) =>
          this.deserializeValue(entry, `${appendPath(path, "value")}[${index}]`)
        )
      );
    }

    if (typeof obj.value !== "string") {
      throw new TypeError(`Invalid Buffer checkpoint value at ${path}: value must be a string`);
    }

    if (!isValidBase64(obj.value)) {
      throw new TypeError(`Invalid Buffer checkpoint value at ${path}: value must be valid base64`);
    }

    return Buffer.from(obj.value, "base64");
  }
}
