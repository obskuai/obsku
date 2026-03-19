import { Effect } from "effect";
import type { ObskuConfig } from "../services/config";
import type { TelemetryConfig } from "../telemetry/types";
import type { AgentDef, ToolResult, ToolUseContent } from "../types";
import type { ResolvedTool } from "./setup";
import {
  executeToolWithMiddleware,
  type SyncExecutionRuntimeOptions,
  type SyncToolCallRuntime,
} from "./sync-execution-middleware";
import { buildTimedToolEffect } from "./sync-execution-result";
import { createToolCallingEvent } from "./tool-call-shared";
import { type EmitFn, safeInputArgs, type ToolExecutionResult } from "./tool-execution-shared";
import { createProgressEmitter } from "./tool-progress";

export function emitToolCallingEvents(
  syncCalls: Array<ToolUseContent>,
  emit: EmitFn
): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (const tc of syncCalls) {
      yield* emit(createToolCallingEvent(tc));
    }
  });
}

export function buildToolEffects(
  syncCalls: Array<ToolUseContent>,
  resolvedTools: Map<string, ResolvedTool>,
  agentDef: AgentDef,
  config: ObskuConfig,
  telemetryConfig?: TelemetryConfig,
  runtime?: SyncExecutionRuntimeOptions,
  emit?: EmitFn
): Array<Effect.Effect<ToolExecutionResult, unknown>> {
  return syncCalls.map((tc) =>
    buildTimedToolEffect(
      tc,
      config,
      buildToolExecutionStage(
        tc,
        createSyncToolCallRuntime(tc, resolvedTools, agentDef, telemetryConfig, runtime, emit)
      )
    )
  );
}

function createSyncToolCallRuntime(
  tc: ToolUseContent,
  resolvedTools: Map<string, ResolvedTool>,
  agentDef: AgentDef,
  telemetryConfig?: TelemetryConfig,
  runtime?: SyncExecutionRuntimeOptions,
  emit?: EmitFn
): SyncToolCallRuntime {
  const controller = new AbortController();
  return {
    agentDef,
    agentName: runtime?.agentName ?? agentDef.name,
    iteration: runtime?.iteration,
    onProgress: createProgressEmitter(tc, emit),
    resolvedTools,
    sessionId: runtime?.sessionId,
    signal: controller.signal,
    telemetryConfig,
  };
}

function buildToolExecutionStage(
  tc: ToolUseContent,
  runtime: SyncToolCallRuntime
): Effect.Effect<ToolResult, unknown> {
  return Effect.tryPromise({
    catch: (err) => err,
    try: () => executeToolWithMiddleware(tc.name, safeInputArgs(tc), runtime),
  });
}

export function executeApprovedSyncTools(
  approvedCalls: Array<ToolUseContent>,
  resolvedTools: Map<string, ResolvedTool>,
  agentDef: AgentDef,
  config: ObskuConfig,
  telemetryConfig?: TelemetryConfig,
  runtime?: SyncExecutionRuntimeOptions,
  emit?: EmitFn
): Effect.Effect<Array<ToolExecutionResult>, unknown> {
  return Effect.all(
    buildToolEffects(
      approvedCalls,
      resolvedTools,
      agentDef,
      config,
      telemetryConfig,
      runtime,
      emit
    ),
    {
      concurrency: config.toolConcurrency,
    }
  );
}
