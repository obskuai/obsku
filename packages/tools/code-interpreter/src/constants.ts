import type { ExecutionResult } from "./types";

export const MAX_INPUT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_OUTPUT_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MAX_SESSIONS = 10;

export function createErrorResult(message: string): ExecutionResult {
  return {
    executionTimeMs: 0,
    exitCode: 1,
    stderr: message,
    stdout: "",
    success: false,
  };
}
