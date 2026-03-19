import { Effect } from "effect";
import type { ObskuConfig } from "../services/config";
import type { Message, ToolResult, ToolUseContent } from "../types";
import { formatError, toToolResultOutput } from "../utils";
import {
  createToolExecutionResult,
  makeErrorEnvelope,
  type ToolExecutionResult,
} from "./tool-execution-shared";

// --- Result helpers ---

function isToolResultShape(value: unknown): value is ToolResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.content === "string" &&
    (record.isError === undefined || typeof record.isError === "boolean") &&
    (record.messages === undefined || Array.isArray(record.messages))
  );
}

export function toToolResult(result: unknown): ToolResult {
  if (isToolResultShape(result)) {
    return result;
  }

  return toToolResultOutput(result);
}

export function wrapToolExecutionResult(
  tc: ToolUseContent,
  result: ToolResult
): ToolExecutionResult {
  return withInjectedMessages(
    createToolExecutionResult(tc, result.content, result.isError === true),
    result.messages ?? []
  );
}

export function wrapToolExecutionError(tc: ToolUseContent, err: unknown): ToolExecutionResult {
  return createToolExecutionResult(tc, makeErrorEnvelope(formatError(err)), true);
}

function withInjectedMessages(
  result: ToolExecutionResult,
  injectedMessages: Array<Message>
): ToolExecutionResult {
  return injectedMessages.length > 0
    ? { ...result, injectedMessages: [...injectedMessages] }
    : result;
}

// --- Timeout (was sync-execution-timeout.ts) ---

export function applyToolTimeout(config: ObskuConfig) {
  return <A, E>(effect: Effect.Effect<A, E>) => effect.pipe(Effect.timeout(config.toolTimeout));
}

export function buildTimedToolEffect(
  tc: ToolUseContent,
  config: ObskuConfig,
  effect: Effect.Effect<ToolResult, unknown>
): Effect.Effect<ToolExecutionResult, never> {
  return effect.pipe(
    applyToolTimeout(config),
    Effect.map((result) => wrapToolExecutionResult(tc, result)),
    Effect.catchAll((err) => Effect.succeed(wrapToolExecutionError(tc, err)))
  );
}
