import type { Entity } from "../../memory/index";
import { isRecord } from "../../utils/type-guards";
import type { Checkpoint, StoredMessage } from "../types";

export type NumberLike = number | string;

export const isNullish = (value: unknown): value is null | undefined =>
  value === null || value === undefined;

export { isRecord };

const isStringArray = (value: unknown): value is Array<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

export const describeValue = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Buffer.isBuffer(value)) return "Buffer";
  if (value instanceof Date) return "Date";
  if (value instanceof Map) return "Map";
  if (value instanceof Set) return "Set";
  return typeof value;
};

export const invalidFieldType = (field: string, expected: string, value: unknown): Error =>
  new Error(`Checkpoint field "${field}" must be ${expected} (got ${describeValue(value)})`);

export const toNumber = (value: NumberLike): number =>
  typeof value === "number" ? value : Number(value);

export const requireStringValue = (value: unknown, field: string): string => {
  if (typeof value === "string") return value;
  throw new Error(`required field "${field}" is not a string (got ${typeof value})`);
};

export const requireNumberValue = (value: unknown, field: string): number => {
  if (typeof value === "number") return value;
  throw invalidFieldType(field, "a number", value);
};

export const coerceNumeric = (
  value: unknown,
  field: string,
  opts?: { strict?: boolean; fieldLabel?: string }
): number | null => {
  const strict = opts?.strict ?? true;
  const fieldLabel = opts?.fieldLabel ?? "Row field";

  if (value === null || value === undefined) {
    if (strict) {
      throw new Error(`required numeric field "${field}" is null or undefined`);
    }
    return null;
  }

  if (typeof value !== "number" && typeof value !== "string") {
    if (strict) {
      throw new Error(`${fieldLabel} "${field}" must be numeric-compatible`);
    }
    return null;
  }

  const numericValue = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numericValue)) {
    if (strict) {
      throw new Error(`${fieldLabel} "${field}" is not numeric`);
    }
    return null;
  }

  return numericValue;
};
const isRelationship = (value: unknown): value is Entity["relationships"][number] =>
  isRecord(value) && typeof value.targetId === "string" && typeof value.type === "string";

const isRelationshipArray = (value: unknown): value is Entity["relationships"] =>
  Array.isArray(value) && value.every(isRelationship);

const isToolCallValue = (
  value: unknown
): value is NonNullable<StoredMessage["toolCalls"]>[number] =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.toolUseId === "string" &&
  isRecord(value.input);

const isToolCallArray = (value: unknown): value is NonNullable<StoredMessage["toolCalls"]> =>
  Array.isArray(value) && value.every(isToolCallValue);

const isToolResultValue = (
  value: unknown
): value is NonNullable<StoredMessage["toolResults"]>[number] =>
  isRecord(value) &&
  typeof value.content === "string" &&
  typeof value.toolUseId === "string" &&
  (value.fullOutputRef === undefined || typeof value.fullOutputRef === "string") &&
  (value.status === undefined || typeof value.status === "string");

const isToolResultArray = (value: unknown): value is NonNullable<StoredMessage["toolResults"]> =>
  Array.isArray(value) && value.every(isToolResultValue);

const isCycleStateValue = (value: unknown): value is NonNullable<Checkpoint["cycleState"]> =>
  isRecord(value) &&
  typeof value.backEdge === "string" &&
  (typeof value.iteration === "number" || typeof value.iteration === "string") &&
  !Number.isNaN(toNumber(value.iteration));

const isCheckpointNodeStatus = (
  value: unknown
): value is
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "Complete"
  | "Failed"
  | "Skipped" =>
  value === "pending" ||
  value === "running" ||
  value === "completed" ||
  value === "failed" ||
  value === "skipped" ||
  value === "Complete" ||
  value === "Failed" ||
  value === "Skipped";

const isCheckpointNodeResultLike = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && isCheckpointNodeStatus(value.status);

const isCheckpointNodeResultsValue = (value: unknown): value is Checkpoint["nodeResults"] =>
  isRecord(value) && Object.values(value).every(isCheckpointNodeResultLike);

export const requireRecordValue = (value: unknown, field: string): Record<string, unknown> => {
  if (isRecord(value)) return value;
  throw invalidFieldType(field, "an object", value);
};

export const requireStringArrayValue = (value: unknown, field: string): Array<string> => {
  if (isStringArray(value)) return value;
  throw invalidFieldType(field, "an array of strings", value);
};

export const requireRelationshipArrayValue = (
  value: unknown,
  field: string
): Entity["relationships"] => {
  if (isRelationshipArray(value)) return value;
  throw invalidFieldType(field, "an array of relationship objects", value);
};

export const requireToolCallsValue = (
  value: unknown,
  field: string
): NonNullable<StoredMessage["toolCalls"]> => {
  if (isToolCallArray(value)) return value;
  throw invalidFieldType(field, "an array of tool call objects", value);
};

export const requireToolResultsValue = (
  value: unknown,
  field: string
): NonNullable<StoredMessage["toolResults"]> => {
  if (isToolResultArray(value)) return value;
  throw invalidFieldType(field, "an array of tool result objects", value);
};

export const requireCycleStateValue = (
  value: unknown,
  field: string
): NonNullable<Checkpoint["cycleState"]> => {
  if (isCycleStateValue(value)) {
    return {
      backEdge: value.backEdge,
      iteration: toNumber(value.iteration),
    };
  }

  throw invalidFieldType(field, "a cycleState object", value);
};

export const requireCheckpointNodeResultsValue = (
  value: unknown,
  field: string
): Checkpoint["nodeResults"] => {
  if (isCheckpointNodeResultsValue(value)) return value;
  throw invalidFieldType(field, "a nodeResults record", value);
};
