import { Effect } from "effect";
import type { TaskManager } from "../background";
import { parseJson } from "../parse-contract";
import type { InternalPlugin } from "../plugin";
import { debugLog } from "../telemetry/log";
import type { ToolUseContent } from "../types";
import { getErrorMessage } from "../utils";
import type { ResolvedTool } from "./setup";
import { createParseErrorEvent, createToolCallingEvent } from "./tool-call-shared";
import {
  createToolExecutionResult,
  type EmitFn,
  makeErrorEnvelope,
  type ToolExecutionResult,
} from "./tool-execution-shared";

function extractTaskId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const taskId = record["taskId"];
  return typeof taskId === "string" ? taskId : undefined;
}

export function launchBackgroundTask(
  tc: ToolUseContent,
  plugin: InternalPlugin | undefined,
  taskManager: TaskManager
): ToolExecutionResult {
  if (!plugin) {
    return createToolExecutionResult(
      tc,
      makeErrorEnvelope(`Tool not found: ${tc.name}`, true),
      true
    );
  }

  const taskId = taskManager.start(tc.name, () =>
    Effect.runPromise(
      plugin.execute({ ...tc.input, wait: true }).pipe(
        Effect.catchAll((err) => {
          const error = getErrorMessage(err);
          debugLog(`Background task execution failed for ${tc.name}: ${error}`);
          return Effect.succeed({
            error,
          });
        })
      )
    )
  );

  return createToolExecutionResult(tc, JSON.stringify({ taskId }));
}

export function emitBackgroundStartEvents(
  results: Array<ToolExecutionResult>,
  callMap: Map<string, ToolUseContent>,
  emit: EmitFn
): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (const result of results) {
      if (result.isError) {
        continue;
      }

      const tc = callMap.get(result.toolUseId);
      const toolName = tc?.name ?? result.toolName;
      const toolUseId = tc?.toolUseId ?? result.toolUseId;
      const parsed = parseJson(result.result);

      if (!parsed.ok) {
        debugLog(
          `Skipping background start event parse failure for ${toolName} (${toolUseId}): ${parsed.error}; raw=${parsed.raw}`
        );
        yield* emit(
          createParseErrorEvent({
            error: parsed.error,
            rawInput: parsed.raw,
            toolName,
            toolUseId,
          })
        ).pipe(
          Effect.catchAll((err) => {
            debugLog(`Background start parse error emit failed: ${err}`);
            return Effect.void;
          })
        );
        continue;
      }

      const taskId = extractTaskId(parsed.value);
      if (!taskId) {
        const error = "Expected background start payload with string taskId";
        debugLog(
          `Skipping background start event invalid payload for ${toolName} (${toolUseId}): ${error}; raw=${result.result}`
        );
        yield* emit(
          createParseErrorEvent({
            error,
            rawInput: result.result,
            toolName,
            toolUseId,
          })
        ).pipe(
          Effect.catchAll((err) => {
            debugLog(`Background start parse error emit failed: ${err}`);
            return Effect.void;
          })
        );
        continue;
      }

      if (tc) {
        yield* emit({
          taskId,
          timestamp: Date.now(),
          toolName: tc.name,
          type: "bg.task.started",
        });
      }
    }
  });
}

export function startBackgroundTasks(
  bgCalls: Array<ToolUseContent>,
  resolvedTools: Map<string, ResolvedTool>,
  taskManager: TaskManager,
  emit: EmitFn
): Effect.Effect<Array<ToolExecutionResult>> {
  return Effect.gen(function* () {
    for (const tc of bgCalls) {
      yield* emit(createToolCallingEvent(tc));
    }

    const bgResults = bgCalls.map((tc) =>
      launchBackgroundTask(tc, resolvedTools.get(tc.name)?.plugin, taskManager)
    );
    const callMap = new Map(bgCalls.map((tc) => [tc.toolUseId, tc]));

    yield* emitBackgroundStartEvents(bgResults, callMap, emit);
    return bgResults;
  });
}
