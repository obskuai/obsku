import type { AgentEvent, ToolUseContent } from "../types";
import { isRecord } from "../utils/type-guards";

type ParseErrorEvent = Extract<AgentEvent, { type: "parse.error" }>;
type ToolCallingEvent = Extract<AgentEvent, { type: "tool.call" }>;

export function isToolInputRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function normalizeToolInputRecord(value: unknown): Record<string, unknown> {
  return isToolInputRecord(value) ? value : {};
}

export function createToolUseContent(
  toolName: string,
  toolUseId: string,
  input: Record<string, unknown>
): ToolUseContent {
  return {
    input,
    name: toolName,
    toolUseId,
    type: "tool_use",
  };
}

export function createToolCallingEvent(
  tc: Pick<ToolUseContent, "input" | "name" | "toolUseId">,
  timestamp = Date.now()
): ToolCallingEvent {
  return {
    args: normalizeToolInputRecord(tc.input),
    timestamp,
    toolName: tc.name,
    toolUseId: tc.toolUseId,
    type: "tool.call",
  };
}

export function createParseErrorEvent(
  params: {
    error: string;
    rawInput?: string;
    toolName?: string;
    toolUseId?: string;
  },
  timestamp = Date.now()
): ParseErrorEvent {
  return {
    ...params,
    timestamp,
    type: "parse.error",
  };
}
