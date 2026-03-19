import { Effect } from "effect";
import { z } from "zod";
import { isZodSchema } from "../plugin";
import type { ObskuConfig } from "../services/config";
import type { TelemetryConfig } from "../telemetry/types";
import type { AgentDef, ToolDef, ToolUseContent } from "../types";

export { startBackgroundTasks } from "./background-launch";

import { emitToolCallingEvents, executeApprovedSyncTools } from "./sync-execution";

export type { EmitFn, ToolExecutionResult } from "./tool-execution-shared";

export function pluginDefToToolDef(t: {
  description: string;
  name: string;
  params?: Record<string, { description?: string; required?: boolean; type: string }> | unknown;
}): ToolDef {
  const source = t;

  if (source.params && isZodSchema(source.params)) {
    const jsonSchema = z.toJSONSchema(source.params) as Record<string, unknown>;
    return {
      description: source.description,
      inputSchema: {
        properties: (jsonSchema.properties ?? {}) as Record<string, unknown>,
        required: jsonSchema.required as Array<string> | undefined,
        type: "object",
      },
      name: source.name,
    };
  }

  const params = (source.params ?? {}) as Record<
    string,
    { description?: string; required?: boolean; type: string }
  >;
  return {
    description: source.description,
    inputSchema: {
      properties: Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, { description: v.description, type: v.type }])
      ),
      required: Object.entries(params)
        .filter(([, v]) => v.required !== false)
        .map(([k]) => k),
      type: "object",
    },
    name: source.name,
  };
}

export function executeSyncTools(
  syncCalls: Array<ToolUseContent>,
  resolvedTools: Map<string, import("./setup").ResolvedTool>,
  agentDef: AgentDef,
  config: ObskuConfig,
  emit: import("./tool-execution-shared").EmitFn,
  telemetryConfig?: TelemetryConfig,
  runtime?: {
    agentName?: string;
    iteration?: number;
    sessionId?: string;
  }
): Effect.Effect<Array<import("./tool-execution-shared").ToolExecutionResult>, unknown> {
  return Effect.gen(function* () {
    yield* emitToolCallingEvents(syncCalls, emit);
    const syncResults = yield* executeApprovedSyncTools(
      syncCalls,
      resolvedTools,
      agentDef,
      config,
      telemetryConfig,
      runtime,
      emit
    );
    // ToolResult events are emitted from agent-loop-base AFTER truncation
    return syncResults;
  });
}
