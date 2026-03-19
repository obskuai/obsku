import { Effect } from "effect";
import { DEFAULTS } from "../defaults";
import { debugLog } from "../telemetry";

import type { AgentEvent, ToolUseContent } from "../types";
import { getErrorMessage } from "../utils";
import type { EmitFn } from "./tool-execution-shared";

function makeToolProgressEvent(toolName: string, toolUseId: string, chunk: unknown): AgentEvent {
  const base = { timestamp: Date.now(), toolName, toolUseId, type: "tool.progress" as const };
  if (typeof chunk === "number") return { ...base, percent: chunk };
  if (typeof chunk === "string") return { ...base, message: chunk };
  if (typeof chunk === "object" && chunk !== null) {
    const record = chunk as Record<string, unknown>;
    return {
      ...base,
      current: typeof record.current === "number" ? record.current : undefined,
      message: typeof record.message === "string" ? record.message : undefined,
      percent: typeof record.percent === "number" ? record.percent : undefined,
      stage: typeof record.stage === "string" ? record.stage : undefined,
      status:
        record.status === "completed" || record.status === "running" || record.status === "waiting"
          ? (record.status as "completed" | "running" | "waiting")
          : undefined,
      total: typeof record.total === "number" ? record.total : undefined,
    };
  }
  return base;
}

function logProgressEmitError(tc: Pick<ToolUseContent, "name" | "toolUseId">, err: unknown): void {
  debugLog(
    `tool_progress_emit_error: tool=${tc.name} toolUseId=${tc.toolUseId} error=${getErrorMessage(err).slice(0, DEFAULTS.preview.logPreviewLength)}`
  );
}

export function createProgressEmitter(
  tc: Pick<ToolUseContent, "name" | "toolUseId">,
  emit?: EmitFn
): ((chunk: unknown) => void) | undefined {
  if (!emit) {
    return undefined;
  }

  return (chunk: unknown) => {
    const progressEvent = makeToolProgressEvent(tc.name, tc.toolUseId, chunk);
    void Effect.runPromise(emit(progressEvent)).catch((err) => {
      try {
        logProgressEmitError(tc, err);
      } catch {
        try {
          process.stderr.write("tool_progress: logging failed\\n");
        } catch {
          /* last resort */
        }
      }
    });
  };
}
