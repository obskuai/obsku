import { Effect } from "effect";
import type { InternalPlugin } from "../plugin";
import { applyDefaults, validateParams } from "../plugin/param-validation";
import { createMiddlewareChain, createToolCallContext } from "../plugin/plugin-ctx";
import { ParamValidationError, PluginExecError } from "../plugin/runtime-wrapping";
import { instrumentToolExecution } from "../telemetry/instrument";
import type { TelemetryConfig } from "../telemetry/types";
import type { AgentDef, ToolResult } from "../types";
import type { ResolvedTool } from "./setup";
import { toToolResult } from "./sync-execution-result";
import { normalizeToolInputRecord } from "./tool-call-shared";
import { makeErrorEnvelope } from "./tool-execution-shared";

// --- Runtime types (was sync-execution-runtime.ts) ---

export interface SyncToolExecutionRuntime {
  agentDef: AgentDef;
  agentName: string;
  iteration?: number;
  parentToolName?: string;
  resolvedTools: Map<string, ResolvedTool>;
  sessionId?: string;
  signal: AbortSignal;
  telemetryConfig?: TelemetryConfig;
  onProgress?: (chunk: unknown) => void;
}

export interface SyncToolCallRuntime
  extends Omit<SyncToolExecutionRuntime, "onProgress" | "signal"> {
  onProgress?: (chunk: unknown) => void;
  signal: AbortSignal;
}

export interface SyncExecutionRuntimeOptions {
  agentName?: string;
  iteration?: number;
  sessionId?: string;
}

// --- Validation (was sync-execution-validation.ts) ---

export function normalizeAndValidateToolInput(
  plugin: InternalPlugin,
  input: unknown
): Record<string, unknown> {
  const normalizedInput = normalizeToolInputRecord(input);
  const nextInput = applyDefaults(normalizedInput, plugin.params);
  const errors = validateParams(nextInput, plugin.params);

  if (errors.length > 0) {
    throw new PluginExecError(plugin.name, new ParamValidationError(errors));
  }

  return nextInput;
}

// --- Middleware ---

async function executeToolDirectly(
  plugin: InternalPlugin,
  toolName: string,
  input: Record<string, unknown>,
  runtime: Pick<SyncToolExecutionRuntime, "onProgress" | "telemetryConfig">
): Promise<ToolResult> {
  const run = () => Effect.runPromise(plugin.execute(input, runtime.onProgress));
  const result = runtime.telemetryConfig?.enabled
    ? await instrumentToolExecution(runtime.telemetryConfig, toolName, run)
    : await run();

  return toToolResult(result);
}

function executeValidatedTool(
  toolName: string,
  plugin: InternalPlugin,
  input: unknown,
  runtime: SyncToolExecutionRuntime
): Promise<ToolResult> {
  return executeToolDirectly(
    plugin,
    toolName,
    normalizeAndValidateToolInput(plugin, input),
    runtime
  );
}

function createToolExecutionContext(
  toolName: string,
  input: unknown,
  resolvedTool: ResolvedTool,
  runtime: SyncToolExecutionRuntime
) {
  const initialInput = normalizeAndValidateToolInput(resolvedTool.plugin, input);
  return createToolCallContext({
    agentName: runtime.agentName,
    executeCall: (nextToolName: string, nextInput: unknown) =>
      executeToolWithMiddleware(nextToolName, nextInput, {
        ...runtime,
        parentToolName: toolName,
      }),
    iteration: runtime.iteration,
    parentToolName: runtime.parentToolName,
    sessionId: runtime.sessionId,
    signal: runtime.signal,
    toolInput: initialInput,
    toolName,
  });
}

export async function executeToolWithMiddleware(
  toolName: string,
  input: unknown,
  runtime: SyncToolExecutionRuntime
): Promise<ToolResult> {
  const resolvedTool = runtime.resolvedTools.get(toolName);
  if (!resolvedTool) {
    return { content: makeErrorEnvelope(`Tool not found: ${toolName}`), isError: true };
  }

  const toolCallCtx = createToolExecutionContext(toolName, input, resolvedTool, runtime);
  const allMiddleware = [...(runtime.agentDef.toolMiddleware ?? []), ...resolvedTool.middleware];
  return createMiddlewareChain(toolCallCtx, allMiddleware, () =>
    executeValidatedTool(toolName, resolvedTool.plugin, toolCallCtx.toolInput, runtime)
  )();
}
