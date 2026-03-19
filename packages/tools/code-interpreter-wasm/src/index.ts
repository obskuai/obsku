import type { CodeInterpreterOptions } from "@obsku/tool-code-interpreter";
import { createCodeInterpreter, SessionManager } from "@obsku/tool-code-interpreter";
import { WasmExecutor } from "./wasm-executor";

export type { ExecutionResult } from "@obsku/tool-code-interpreter";
export type { WasmContext, WasmRuntime, WasmRuntimeOptions } from "./runtimes/types";
export { WasmExecutor } from "./wasm-executor";
export { WasmSessionManager } from "./wasm-session-manager";

/**
 * Creates a code interpreter using WasmExecutor for sandboxed WASM execution.
 * Provides a more isolated execution environment compared to LocalProcessExecutor.
 */
export function createWasmCodeInterpreter(opts: CodeInterpreterOptions = {}) {
  const executor = opts.executor ?? new WasmExecutor();
  const sessionManager = opts.sessionManager ?? new SessionManager();
  return createCodeInterpreter({ executor, sessionManager });
}
