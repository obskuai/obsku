import type { CheckpointNodeResult } from "../checkpoint/types";
import { isRecord } from "../utils/type-guards";
import { getErrorMessage } from "../utils";
import type {
  CompleteGraphResult,
  ExecuteGraphOptions,
  FailedGraphResult,
  FailedNodeResult,
  GraphFailureEnvelope,
  GraphResult,
  InterruptedGraphResult,
  NodeResult,
} from "./types";
import { isGraphFailureEnvelope, makeGraphFailureEnvelope } from "./types";

function invalidCheckpointNodeResult(value: unknown): Error {
  return new Error(`Invalid NodeResult from checkpoint: ${JSON.stringify(value)}`);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLegacyCheckpointNodeResult(value: unknown): value is CheckpointNodeResult {
  return (
    isRecord(value) &&
    (value.status === "completed" || value.status === "failed" || value.status === "skipped")
  );
}

function toValidDuration(duration: unknown, rawValue: unknown): number {
  if (!isFiniteNumber(duration) || duration < 0) {
    throw invalidCheckpointNodeResult(rawValue);
  }

  return duration;
}

function toLegacyDuration(record: CheckpointNodeResult, rawValue: unknown): number {
  const { completedAt, startedAt } = record;

  if (startedAt !== undefined && !isFiniteNumber(startedAt)) {
    throw invalidCheckpointNodeResult(rawValue);
  }

  if (completedAt !== undefined && !isFiniteNumber(completedAt)) {
    throw invalidCheckpointNodeResult(rawValue);
  }

  const normalizedStartedAt = startedAt ?? 0;
  const normalizedCompletedAt = completedAt ?? normalizedStartedAt;

  return Math.max(0, normalizedCompletedAt - normalizedStartedAt);
}

function resolveErrorMessageForEnvelope(record: { error?: unknown; output?: unknown }): {
  message: string;
  preserveEnvelope: boolean;
} {
  // Explicit error string takes precedence
  if (typeof record.error === "string") {
    return { message: record.error, preserveEnvelope: false };
  }

  // If output is already a valid failure envelope, preserve it entirely
  if (isGraphFailureEnvelope(record.output)) {
    return { message: record.output.error, preserveEnvelope: true };
  }

  // Fall back to output as string or formatted
  if (typeof record.output === "string") {
    return { message: record.output, preserveEnvelope: false };
  }

  return { message: getErrorMessage(record.output), preserveEnvelope: false };
}

function extractFailureEnvelope(record: {
  error?: unknown;
  output?: unknown;
}): GraphFailureEnvelope {
  const { message, preserveEnvelope } = resolveErrorMessageForEnvelope(record);

  // Preserve the original envelope structure if it was already a valid envelope
  if (preserveEnvelope && isGraphFailureEnvelope(record.output)) {
    return record.output;
  }

  return makeGraphFailureEnvelope(message);
}

function toFailedResult(duration: number, output: { error: string }): FailedNodeResult {
  return {
    duration,
    output,
    status: "Failed",
  };
}

function validateSkippedOutput(output: unknown, rawValue: unknown): void {
  if (output !== undefined) {
    throw invalidCheckpointNodeResult(rawValue);
  }
}

function createSkippedResult(duration: number): NodeResult {
  return { duration, output: undefined, status: "Skipped" };
}

function restoreNormalizedNodeResult(rawValue: Record<string, unknown>): NodeResult | null {
  const status = rawValue.status;
  if (status !== "Complete" && status !== "Failed" && status !== "Skipped") {
    return null;
  }

  const duration = toValidDuration(rawValue.duration, rawValue);

  if (status === "Complete") {
    return { duration, output: rawValue.output, status: "Complete" };
  }

  if (status === "Skipped") {
    validateSkippedOutput(rawValue.output, rawValue);
    return createSkippedResult(duration);
  }

  return toFailedResult(duration, extractFailureEnvelope(rawValue));
}

function restoreLegacyCheckpointNodeResult(rawValue: CheckpointNodeResult): NodeResult {
  const duration = toLegacyDuration(rawValue, rawValue);

  if (rawValue.status === "completed") {
    return { duration, output: rawValue.output, status: "Complete" };
  }

  if (rawValue.status === "skipped") {
    validateSkippedOutput(rawValue.output, rawValue);
    return createSkippedResult(duration);
  }

  return toFailedResult(duration, extractFailureEnvelope(rawValue));
}

export function toGraphResultsRecord(
  results: ReadonlyMap<string, NodeResult>
): Record<string, NodeResult> {
  return Object.fromEntries(results);
}

export function makeCompleteGraphResult(
  results: ReadonlyMap<string, NodeResult>
): CompleteGraphResult {
  return {
    results: toGraphResultsRecord(results),
    status: "Complete",
  };
}

export function makeInterruptedGraphResult(
  results: ReadonlyMap<string, NodeResult>
): InterruptedGraphResult {
  return {
    results: toGraphResultsRecord(results),
    status: "Interrupted",
  };
}

export function makeFailedGraphResult(
  results: ReadonlyMap<string, NodeResult>,
  fallback: string
): FailedGraphResult {
  return {
    error: getFailedGraphEnvelope(results, fallback),
    results: toGraphResultsRecord(results),
    status: "Failed",
  };
}

export function toCheckpointNodeResult(value: unknown): NodeResult {
  if (!isRecord(value) || !("status" in value)) {
    throw invalidCheckpointNodeResult(value);
  }

  const normalizedNodeResult = restoreNormalizedNodeResult(value);
  if (normalizedNodeResult) {
    return normalizedNodeResult;
  }

  if (isLegacyCheckpointNodeResult(value)) {
    return restoreLegacyCheckpointNodeResult(value);
  }

  throw invalidCheckpointNodeResult(value);
}

export function getFailedGraphEnvelope(
  results: ReadonlyMap<string, NodeResult>,
  fallback: string
): GraphFailureEnvelope {
  for (const result of Array.from(results.values()).reverse()) {
    if (result.status === "Failed") {
      return result.output;
    }
  }

  return makeGraphFailureEnvelope(fallback);
}

function hasFailedNodeResult(results: ReadonlyMap<string, NodeResult>): boolean {
  return Array.from(results.values()).some((result) => result.status === "Failed");
}

export function restoreCheckpointNodeResults(
  results: Map<string, NodeResult>,
  resumeFrom?: ExecuteGraphOptions["resumeFrom"]
): boolean {
  if (!resumeFrom?.nodeResults) {
    return false;
  }

  for (const [nodeId, nodeResult] of Object.entries(resumeFrom.nodeResults)) {
    results.set(nodeId, toCheckpointNodeResult(nodeResult));
  }

  return true;
}

export function getRestoredCheckpointGraphResult(
  results: ReadonlyMap<string, NodeResult>,
  restored: boolean
): GraphResult | null {
  if (!restored || !hasFailedNodeResult(results)) {
    return null;
  }

  return makeFailedGraphResult(results, "Graph execution failed");
}
