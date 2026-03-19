export { serializeExecutionResult } from "./serialization";

/**
 * Code Interpreter Tool - Core Types
 *
 * Foundation for executing code in isolated environments.
 */

import { DEFAULTS } from "@obsku/framework";
import { buildCodeInterpreterPlugin } from "./plugin-builder";

export type { InputFilesRecord, InputFilesValue } from "./plugin-builder";

import { LocalProcessExecutor } from "./local-executor";
import type { EnvFilterOptions } from "@obsku/framework";

export type { EnvFilterOptions } from "@obsku/framework";

import { SessionManager } from "./session-manager";
import type { CodeExecutor, ExecutionOptions, ExecutionResult } from "./types";

export type { BaseSessionRecord } from "./base-session-manager";
export { BaseSessionManager } from "./base-session-manager";
export {
  createErrorResult,
  DEFAULT_MAX_SESSIONS,
  MAX_INPUT_FILE_BYTES,
  MAX_TOTAL_OUTPUT_BYTES,
} from "./constants";

// Re-export timeout constants from framework DEFAULTS for backward compatibility
export const DEFAULT_TIMEOUT_MS = DEFAULTS.codeInterpreterExecTimeout;
export const DEFAULT_MAX_DURATION_MS = DEFAULTS.codeInterpreterMaxDuration;
export const DEFAULT_IDLE_TIMEOUT_MS = DEFAULTS.codeInterpreterIdleTimeout;

export { LocalProcessExecutor } from "./local-executor";
// Re-export auto-discovery types
export type { CodeInterpreterBackend, ResolvedCodeExecutor } from "./resolve-executor";
export { SessionManager } from "./session-manager";
export type * from "./types";
export type { WorkspaceContext } from "./workspace";
export { createWorkspace, PathTraversalError } from "./workspace";

import type { CodeInterpreterBackend, ResolvedCodeExecutor } from "./resolve-executor";
import { resolveCodeExecutor } from "./resolve-executor";

const DESCRIPTION =
  "Execute Python, JavaScript, or TypeScript code in a sandboxed environment. Supports stateless execution and stateful sessions with file I/O.";
const SECURITY_WARNING =
  "Warning: This tool executes arbitrary code. Child-process env vars matching common secret patterns are filtered by default, but you should still avoid running it with sensitive credentials and review outputs carefully.";

export interface CodeInterpreterOptions {
  /** Force a specific backend. If not set, auto-discovers: agentcore > wasm > local */
  backend?: CodeInterpreterBackend;
  envFilter?: EnvFilterOptions;
  /** Explicit executor (bypasses auto-discovery) */
  executor?: CodeExecutor;
  resolveExecutor?: (backend?: CodeInterpreterBackend) => Promise<ResolvedCodeExecutor>;
  sessionManager?: SessionManager;
}

/**
 * Create a lazy executor that resolves the backend on first use.
 */
const createLazyExecutor = (getResolved: () => Promise<ResolvedCodeExecutor>): CodeExecutor => ({
  name: "lazy-auto",
  supportedLanguages: ["python", "javascript", "typescript"],
  initialize: async () => {
    const r = await getResolved();
    await r.executor.initialize();
  },
  execute: async (options: ExecutionOptions) => {
    const r = await getResolved();
    await r.executor.initialize();
    return r.executor.execute(options);
  },
  dispose: async () => {
    // Lazy executor doesn't own the resolved executor, so no-op
  },
  createSession: async (id: string, opts) => {
    const r = await getResolved();
    await r.executor.initialize();
    return r.executor.createSession?.(id, opts);
  },
  destroySession: async (id: string) => {
    const r = await getResolved();
    return r.executor.destroySession?.(id);
  },
});

/**
 * Create a lazy session manager that delegates to the resolved one.
 * MinimalSessionManager only requires execute(), so we only proxy that.
 */
const createLazySessionManager = (
  getResolved: () => Promise<ResolvedCodeExecutor>
): {
  execute: (options: ExecutionOptions & { sessionId: string }) => Promise<ExecutionResult>;
} => ({
  execute: async (options: ExecutionOptions & { sessionId: string }) => {
    const r = await getResolved();
    await r.executor.initialize();
    return r.sessionManager.execute(options);
  },
});

export const createCodeInterpreter = (opts: CodeInterpreterOptions = {}) => {
  // If explicit executor provided, use existing eager behavior (no auto-discovery)
  if (opts.executor) {
    const executor = opts.executor;
    const sessionManager = opts.sessionManager ?? new SessionManager({ envFilter: opts.envFilter });
    return buildCodeInterpreterPlugin({
      description: DESCRIPTION,
      executor,
      securityWarning: SECURITY_WARNING,
      sessionManager,
    });
  }

  // Lazy auto-discovery path
  let resolvePromise: Promise<ResolvedCodeExecutor> | null = null;
  const resolveExecutor = opts.resolveExecutor ?? resolveCodeExecutor;
  const getResolved = (): Promise<ResolvedCodeExecutor> =>
    (resolvePromise ??= resolveExecutor(opts.backend));

  const lazyExecutor = createLazyExecutor(getResolved);

  // If sessionManager is explicitly provided, use it; otherwise use lazy one
  const sessionManager =
    opts.sessionManager ?? (createLazySessionManager(getResolved) as SessionManager);

  return buildCodeInterpreterPlugin({
    description: DESCRIPTION,
    executor: lazyExecutor,
    securityWarning: SECURITY_WARNING,
    sessionManager,
  });
};

export const codeInterpreter = createCodeInterpreter();
