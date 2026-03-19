import { parseAndValidate } from "../parse-contract";
import { debugLog } from "../telemetry/log";
import type { ToolCall } from "../types/llm";
import {
  ParsedStoredMessageSchema,
  StoredMessageRecordSchema,
  StoredMessageSchema,
  StoredToolCallSchema,
  StoredToolResultSchema,
  ToolCallInputSchema,
  validate,
} from "./schemas";
import type { StoredMessage, StoredToolResult } from "./types";

/**
 * Parse and validate a raw stored message from storage.
 * Validates canonical stored format and converts tool calls to runtime format.
 * Returns null if the message is invalid.
 */
export function parseStoredMessage(raw: unknown): StoredMessage | null {
  const stored = validate(StoredMessageSchema, raw);
  if (!stored) {
    return null;
  }

  const toolCalls = stored.toolCalls
    ?.map((toolCall) => {
      const result = parseAndValidate(toolCall.function.arguments, ToolCallInputSchema);
      if (result.ok) {
        return {
          input: result.value,
          name: toolCall.function.name,
          toolUseId: toolCall.id,
        };
      }
      if ("raw" in result) {
        debugLog(
          `Skipping stored tool call with invalid JSON arguments: toolUseId=${toolCall.id}, raw=${result.raw}`
        );
      } else {
        debugLog(
          `Skipping stored tool call with invalid argument schema: toolUseId=${toolCall.id}, value=${JSON.stringify(result.value)}`
        );
      }
      return null;
    })
    .filter((call): call is ToolCall => call !== null);

  return validate(ParsedStoredMessageSchema, {
    ...stored,
    toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
  });
}

/**
 * Type guard to check if raw data is already a valid StoredMessage.
 */
export function isStoredMessage(raw: unknown): raw is StoredMessage {
  const recordResult = StoredMessageRecordSchema.safeParse(raw);
  if (!recordResult.success) {
    return false;
  }
  const record = recordResult.data;
  if (
    typeof record.createdAt !== "number" ||
    typeof record.id !== "number" ||
    typeof record.role !== "string" ||
    typeof record.sessionId !== "string"
  ) {
    return false;
  }
  if (record.toolCalls !== undefined && !isToolCalls(record.toolCalls)) {
    return false;
  }
  if (record.toolResults !== undefined && !isToolResults(record.toolResults)) {
    return false;
  }
  return true;
}

/**
 * Type guard to check if value is an array of stored tool calls (canonical format).
 */
function isToolCalls(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((toolCall) => {
    if (!toolCall || typeof toolCall !== "object") {
      return false;
    }
    const recordResult = StoredToolCallSchema.safeParse(toolCall);
    if (!recordResult.success) {
      debugLog("Invalid tool call payload in message");
      return false;
    }
    return true;
  });
}

/**
 * Type guard to check if value is an array of StoredToolResult.
 */
function isToolResults(value: unknown): value is Array<StoredToolResult> {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((toolResult) => {
    if (!toolResult || typeof toolResult !== "object") {
      return false;
    }
    const recordResult = StoredToolResultSchema.safeParse(toolResult);
    if (!recordResult.success) {
      debugLog("Invalid tool result payload in message");
      return false;
    }
    return true;
  });
}
