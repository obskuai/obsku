import { Effect } from "effect";
import { LOG_PREVIEW_MAX_LENGTH } from "../constants";
import type { ObskuConfig } from "../services/config";
import { telemetryLog } from "../telemetry";

import type { Message, ToolUseContent } from "../types";
import { formatError, normalizeToolResultPayload, toToolResultOutput } from "../utils";
import {
  createToolExecutionResult,
  makeErrorEnvelope,
  type ToolExecutionResult,
} from "./tool-execution-shared";

export function normalizeToolResult(result: unknown): { isError: boolean; result: string } | null {
  return normalizeToolResultPayload(result);
}

export function buildSingleToolEffect<E>(
  baseEffect: Effect.Effect<unknown, E>,
  tc: ToolUseContent,
  config: ObskuConfig
): Effect.Effect<ToolExecutionResult> {
  return baseEffect.pipe(
    Effect.timeout(config.toolTimeout),
    Effect.map((result) => {
      const normalizedResult = toToolResultOutput(result);
      if (!normalizeToolResultPayload(result)) {
        telemetryLog(`Unexpected tool result shape for ${tc.name}, normalized through boundary`);
      }
      const base = createToolExecutionResult(
        tc,
        normalizedResult.content,
        normalizedResult.isError === true
      );
      const injected = extractInjectedMessages(result);
      return injected.length > 0 ? { ...base, injectedMessages: injected } : base;
    }),
    Effect.catchAll((err) => {
      const errorMsg = formatError(err);
      telemetryLog(
        `plugin_execution_error: plugin=${tc.name} error=${errorMsg.slice(0, LOG_PREVIEW_MAX_LENGTH)}`
      );
      return Effect.succeed(createToolExecutionResult(tc, makeErrorEnvelope(errorMsg), true));
    })
  );
}

/**
 * Extract injected messages from a ToolResult.
 * Both short-circuited and executed middleware results may carry messages to inject
 * into the conversation. This preserves them onto ToolExecutionResult.injectedMessages
 * so applyToolResults() can add them to the message history.
 */
function extractInjectedMessages(result: unknown): Array<Message> {
  if (result !== null && typeof result === "object") {
    const msgs = (result as Record<string, unknown>).messages;
    if (Array.isArray(msgs)) {
      return msgs as Array<Message>;
    }
  }
  return [];
}
