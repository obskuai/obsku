import { Effect } from "effect";
import type { AgentEvent, Message, ToolUseContent } from "../types";
import { normalizeToolInputRecord } from "./tool-call-shared";

export type EmitFn = (event: AgentEvent) => Effect.Effect<boolean>;

export type ToolExecutionResult =
  | {
      injectedMessages?: Array<Message>;
      isError: false;
      result: string;
      toolName: string;
      toolUseId: string;
    }
  | {
      injectedMessages?: Array<Message>;
      isError: true;
      result: string;
      toolName: string;
      toolUseId: string;
    };

export function safeInputArgs(tc: ToolUseContent): Record<string, unknown> {
  return normalizeToolInputRecord(tc.input);
}

export function createToolExecutionResult(
  tc: Pick<ToolUseContent, "name" | "toolUseId">,
  result: string,
  isError = false
): ToolExecutionResult {
  return {
    isError,
    result,
    toolName: tc.name,
    toolUseId: tc.toolUseId,
  } as ToolExecutionResult;
}

export function makeErrorEnvelope(message: string, includeIsError?: boolean): string {
  return includeIsError
    ? JSON.stringify({ error: message, isError: true })
    : JSON.stringify({ error: message });
}
