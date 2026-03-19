import { DEFAULT_TIMEOUT_MS, type ExecutionResult } from "@obsku/tool-code-interpreter";
import type { WasmRuntimeOptions } from "./types";

export { DEFAULT_TIMEOUT_MS } from "@obsku/tool-code-interpreter";

/** Mutable execution state passed to WASM runtime executor callbacks. */
export interface WasmExecutionState {
  exitCode: number;
  isTimeout: boolean;
  stderr: string;
  stdout: string;
}

/** Minimal workspace interface required by the execution orchestrator. */
interface ExecutionWorkspace {
  collectOutputFiles(excludeInputs: Array<string>): Promise<Map<string, Uint8Array>>;
}

export function createExecutionResult(
  success: boolean,
  stdout: string,
  stderr: string,
  executionTimeMs: number,
  exitCode?: number,
  outputFiles?: Map<string, Uint8Array>,
  isTimeout?: boolean
): ExecutionResult {
  return {
    executionTimeMs,
    exitCode,
    isTimeout,
    outputFiles: outputFiles && outputFiles.size > 0 ? outputFiles : undefined,
    stderr,
    stdout,
    success,
  };
}

/**
 * Shared orchestration wrapper for WASM runtime execution.
 *
 * Handles: timing setup, input file snapshot, output file collection,
 * timeout message fallback, and ExecutionResult assembly.
 *
 * Runtime-specific logic (eval, capture, interrupt) lives in `executor`.
 */
export async function runWasmExecution(
  workspace: ExecutionWorkspace,
  options: WasmRuntimeOptions,
  executor: (state: WasmExecutionState, timeoutMs: number) => Promise<void>
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const inputFiles = await workspace.collectOutputFiles([]);

  const state: WasmExecutionState = {
    exitCode: 0,
    isTimeout: false,
    stderr: "",
    stdout: "",
  };

  await executor(state, timeoutMs);

  if (state.isTimeout && !state.stderr) {
    state.stderr = "Execution timed out";
  }

  const executionTimeMs = Date.now() - startTime;
  const outputFiles = await workspace.collectOutputFiles(Array.from(inputFiles.keys()));
  const success = state.exitCode === 0 && !state.isTimeout;

  return createExecutionResult(
    success,
    state.stdout,
    state.stderr,
    executionTimeMs,
    state.exitCode,
    outputFiles,
    state.isTimeout
  );
}
