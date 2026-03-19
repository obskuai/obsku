import { getWrappedToolResultCandidate } from "./envelope-parsers";
import { asRecord, isToolOutput } from "./shared";
import type { ToolResultPayload } from "./types";

function isToolExecutionResultPayload(value: unknown): value is ToolResultPayload & {
  toolName: string;
  toolUseId: string;
} {
  const record = asRecord(value);
  return (
    record != null &&
    typeof record.result === "string" &&
    typeof record.isError === "boolean" &&
    typeof record.toolName === "string" &&
    typeof record.toolUseId === "string"
  );
}

export function parseToolExecutionPayload(value: unknown): ToolResultPayload | null {
  if (!isToolExecutionResultPayload(value)) {
    return null;
  }

  return { isError: value.isError, result: value.result };
}

export function parseWrappedToolResultPayload(value: unknown): ToolResultPayload | null {
  const candidate = getWrappedToolResultCandidate(value);
  if (candidate == null) {
    return null;
  }

  return { isError: candidate.isError ?? false, result: candidate.result };
}

export function parseToolOutputPayload(value: unknown): ToolResultPayload | null {
  if (!isToolOutput(value)) {
    return null;
  }

  return { isError: value.isError ?? false, result: value.content };
}
