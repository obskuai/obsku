/**
 * Shared serialization utilities for code interpreter results
 *
 * Provides consistent JSON serialization of execution results across
 * all code interpreter implementations (local, AgentCore, WASM).
 */

import type { ExecutionResult } from "./types";

/**
 * Serialized execution result structure
 * outputFiles is converted from Map to Record with base64-encoded values
 */
export interface SerializedExecutionResult {
  executionTimeMs: number;
  exitCode?: number;
  isTimeout?: boolean;
  outputFiles?: Record<string, string>;
  stderr: string;
  stdout: string;
  success: boolean;
}

/**
 * Serializes an ExecutionResult to JSON string.
 * Converts outputFiles Map to a Record with base64-encoded values.
 *
 * @param result - The execution result to serialize
 * @returns JSON string representation
 */
export function serializeExecutionResult(result: ExecutionResult): string {
  const outputFiles = result.outputFiles
    ? Object.fromEntries(
        Array.from(result.outputFiles.entries()).map(([name, content]) => [
          name,
          Buffer.from(content).toString("base64"),
        ])
      )
    : undefined;

  return JSON.stringify({
    ...result,
    outputFiles,
  });
}
