/**
 * Core types for the code interpreter tool
 */

/**
 * Supported programming languages for code execution
 */
export type SupportedLanguage = "python" | "javascript" | "typescript";

/**
 * Options for executing code
 */
export interface ExecutionOptions {
  /** The code to execute */
  code: string;
  /** Input files to make available during execution (filename -> content, supports binary) */
  inputFiles?: Map<string, string | Uint8Array>;
  /** The programming language */
  language: SupportedLanguage;
  /** Optional session ID for persistent execution context */
  sessionId?: string;
  /** Timeout in milliseconds (default: {@link DEFAULTS.codeInterpreterExecTimeout}) */
  timeoutMs?: number;
  /** Optional workspace directory path */
  workspaceDir?: string;
}

/**
 * Result of code execution
 */
export interface ExecutionResult {
  /** Execution time in milliseconds */
  executionTimeMs: number;
  /** Exit code if applicable */
  exitCode?: number;
  /** Whether execution timed out */
  isTimeout?: boolean;
  /** Output files generated during execution (filename -> content) */
  outputFiles?: Map<string, Uint8Array>;
  /** Standard error from execution */
  stderr: string;
  /** Standard output from execution */
  stdout: string;
  /** Whether execution succeeded */
  success: boolean;
}

/**
 * Options for creating a new execution session
 */
export interface SessionOptions {
  /** Idle timeout in milliseconds (default: {@link DEFAULTS.codeInterpreterIdleTimeout} = 15 minutes) */
  idleTimeoutMs?: number;
  /** The programming language for this session */
  language: SupportedLanguage;
  /** Maximum session duration in milliseconds (default: {@link DEFAULTS.codeInterpreterMaxDuration} = 1 hour) */
  maxDurationMs?: number;
}

/**
 * WASM-specific execution options extending base ExecutionOptions
 */
export interface WasmExecutionOptions extends ExecutionOptions {
  /** Whether to interrupt execution on timeout */
  interruptOnTimeout?: boolean;
  /** Memory limit in megabytes for WASM runtime */
  memoryLimitMb?: number;
}

/**
 * Interface for code executors
 */
export interface CodeExecutor {
  /**
   * Create a new execution session (optional)
   */
  createSession?(id: string, opts: SessionOptions): Promise<void>;
  /**
   * Destroy an execution session (optional)
   */
  destroySession?(id: string): Promise<void>;

  /**
   * Dispose of the executor and clean up resources
   */
  dispose(): Promise<void>;

  /**
   * Execute code with the given options
   */
  execute(options: ExecutionOptions): Promise<ExecutionResult>;

  /**
   * Initialize the executor
   */
  initialize(): Promise<void>;

  /** Executor name */
  name: string;

  /** Languages supported by this executor */
  supportedLanguages: Array<SupportedLanguage>;
}
