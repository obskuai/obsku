import type { FailedToolResultStatus, ToolOutput, ToolResultObject } from "./types";

const terminalFailureStatuses = new Set<string>(["completed", "failed", "not_found", "timeout"]);

export function asRecord(value: unknown): ToolResultObject | null {
  return value != null && typeof value === "object" ? (value as ToolResultObject) : null;
}

export function isTerminalFailureStatus(value: unknown): value is FailedToolResultStatus {
  return typeof value === "string" && terminalFailureStatuses.has(value);
}

export function normalizeFailedStatus(value: unknown): FailedToolResultStatus {
  return isTerminalFailureStatus(value) ? value : "completed";
}

export function isErrorRecord(value: unknown): value is { error: string } {
  const record = asRecord(value);
  return record != null && typeof record.error === "string";
}

export function toErrorMessage(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return "Unknown error";
  }

  if (isErrorRecord(value)) {
    return value.error;
  }

  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? serialized : "Unknown error";
}

export function serializeToolResultContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? serialized : "undefined";
}

export function isToolOutput(value: unknown): value is ToolOutput {
  const obj = asRecord(value);
  if (obj == null) {
    return false;
  }

  const keys = Object.keys(obj);

  return (
    keys.length >= 1 &&
    keys.length <= 2 &&
    "content" in obj &&
    typeof obj.content === "string" &&
    (keys.length === 1 || (keys.length === 2 && "isError" in obj))
  );
}
