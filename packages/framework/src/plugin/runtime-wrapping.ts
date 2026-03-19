// =============================================================================
// @obsku/framework — Plugin execution errors + runtime result wrapping
// =============================================================================

import { Effect } from "effect";
import { formatError, isAsyncIterable, toToolResultOutput } from "../utils";

// Error Pattern Convention:
// - Public/consumer errors: extends Error + readonly _tag (e.g. PluginExecError, RemoteAgentError)
//   → Consumers catch with instanceof, _tag enables pattern matching
// - Effect-internal errors: Data.TaggedError (e.g. LLMThrottleError, McpConnectionError)
//   → Used with Effect.catchTag in service layers, never exposed to consumers

export class PluginExecError extends Error {
  readonly _tag = "PluginExecError" as const;
  constructor(
    readonly pluginName: string,
    readonly cause: unknown
  ) {
    super(`Plugin "${pluginName}" failed: ${formatError(cause)}`);
    this.name = "PluginExecError";
  }
}

export class ParamValidationError extends Error {
  readonly _tag = "ParamValidationError" as const;
  constructor(readonly details: Array<string>) {
    super(`Parameter validation failed: ${details.join(", ")}`);
    this.name = "ParamValidationError";
  }
}

export interface PluginExecutionResult {
  isError?: boolean;
  result: string;
}

function processPluginResult(result: unknown): PluginExecutionResult {
  const output = toToolResultOutput(result);
  return { isError: output.isError, result: output.content };
}

export function executePluginRun(
  runResult: unknown,
  pluginName: string,
  onProgress?: (chunk: unknown) => void
): Effect.Effect<PluginExecutionResult, PluginExecError> {
  if (isAsyncIterable(runResult)) {
    return Effect.tryPromise<PluginExecutionResult, PluginExecError>({
      catch: (err: unknown) => new PluginExecError(pluginName, err),
      try: async () => {
        let lastValue: unknown;
        for await (const chunk of runResult) {
          lastValue = chunk;
          onProgress?.(chunk);
        }
        // For async iterables, preserve raw value (NOT ToolOutput detection)
        // This matches test expectations for streaming plugins
        return {
          result: typeof lastValue === "string" ? lastValue : JSON.stringify(lastValue),
        };
      },
    });
  }

  return Effect.tryPromise<PluginExecutionResult, PluginExecError>({
    catch: (err: unknown) => new PluginExecError(pluginName, err),
    try: async () => processPluginResult(await runResult),
  });
}
