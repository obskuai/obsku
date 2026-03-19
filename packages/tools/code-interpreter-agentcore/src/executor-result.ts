import { getErrorMessage } from "@obsku/framework";
import { ExecutorStageError } from "./executor-stage-error";
import type { StructuredContent } from "./parser";
import type { AgentCoreExecutionResult, ExecutionResult } from "./types";

export function buildExecutionResult(
  execContent: StructuredContent | undefined,
  startedAt: number,
  outputFiles: Map<string, Uint8Array> | undefined
): ExecutionResult {
  const exitCode = execContent?.exitCode;
  return {
    executionTimeMs:
      typeof execContent?.executionTime === "number"
        ? execContent.executionTime
        : Date.now() - startedAt,
    exitCode,
    outputFiles,
    stderr: execContent?.stderr ?? "",
    stdout: execContent?.stdout ?? "",
    success: exitCode === 0,
  };
}

export function buildFailureResult(error: unknown): AgentCoreExecutionResult {
  return {
    executionTimeMs: 0,
    exitCode: 1,
    failedStage: error instanceof ExecutorStageError ? error.stage : undefined,
    stderr: error instanceof ExecutorStageError ? error.message : getErrorMessage(error),
    stdout: "",
    success: false,
  };
}

export function attachCleanupError(
  result: AgentCoreExecutionResult,
  cleanupError: string | undefined
): AgentCoreExecutionResult {
  if (cleanupError === undefined) {
    return result;
  }
  return { ...result, cleanupError };
}
