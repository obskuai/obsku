import { withSpan } from "./tracer";
import type { TelemetryConfig } from "./types";

/**
 * Telemetry Instrumentation - OpenTelemetry integration for framework operations.
 *
 * IMPORTANT: Telemetry operates on canonical events and types only.
 * No transport-specific transformations should occur here.
 * Adapter-specific telemetry belongs in the adapter layer.
 */

export async function instrumentLLMCall<T>(
  config: TelemetryConfig | undefined,
  provider: string,
  model: string,
  fn: () => Promise<T>
): Promise<T> {
  return withSpan(config, "llm.call", fn, {
    "gen_ai.request.model": model,
    "gen_ai.system": provider,
  });
}

export async function instrumentToolExecution<T>(
  config: TelemetryConfig | undefined,
  toolName: string,
  fn: () => Promise<T>
): Promise<T> {
  return withSpan(config, "tool.execute", fn, {
    "tool.name": toolName,
  });
}

export async function instrumentCheckpoint<T>(
  config: TelemetryConfig | undefined,
  operation: "save" | "load" | "fork",
  fn: () => Promise<T>
): Promise<T> {
  return withSpan(config, `checkpoint.${operation}`, fn);
}
