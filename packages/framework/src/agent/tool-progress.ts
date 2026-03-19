import { Effect } from "effect";
import { LOG_PREVIEW_MAX_LENGTH } from "../constants";
import { telemetryLog } from "../telemetry";

import type { AgentEvent, ToolUseContent } from "../types";
import { formatError } from "../utils";
import type { EmitFn } from "./tool-execution-shared";

function makeToolProgressEvent(toolName: string, toolUseId: string, chunk: unknown): AgentEvent {
  const base = { timestamp: Date.now(), toolName, toolUseId, type: "tool.progress" as const };
  if (typeof chunk === "number") return { ...base, percent: chunk };
  if (typeof chunk === "string") return { ...base, message: chunk };
  if (typeof chunk === "object" && chunk !== null) {
    const c = chunk as Record<string, unknown>;
    return {
      ...base,
      current: typeof c.current === "number" ? c.current : undefined,
      message: typeof c.message === "string" ? c.message : undefined,
      percent: typeof c.percent === "number" ? c.percent : undefined,
      stage: typeof c.stage === "string" ? c.stage : undefined,
      status:
        c.status === "completed" || c.status === "running" || c.status === "waiting"
          ? (c.status as "completed" | "running" | "waiting")
          : undefined,
      total: typeof c.total === "number" ? c.total : undefined,
    };
  }
  return base;
}

function logProgressEmitError(tc: Pick<ToolUseContent, "name" | "toolUseId">, err: unknown): void {
  telemetryLog(
    `tool_progress_emit_error: tool=${tc.name} toolUseId=${tc.toolUseId} error=${formatError(err).slice(0, LOG_PREVIEW_MAX_LENGTH)}`
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
