/**
 * Runtime types for WASM code execution
 */
import type { ExecutionResult, SupportedLanguage } from "@obsku/tool-code-interpreter";

/**
 * WASM runtime interface for executing code in isolated contexts
 */
export interface WasmRuntime {
  /**
   * Create a new execution context
   */
  createContext(id: string): Promise<WasmContext>;
  /**
   * Destroy an execution context
   */
  destroyContext(id: string): Promise<void>;

  /**
   * Dispose of the runtime and clean up resources
   */
  dispose(): Promise<void>;

  /**
   * Execute code with the given options
   */
  execute(code: string, options?: WasmRuntimeOptions): Promise<ExecutionResult>;

  /**
   * Initialize the runtime
   */
  initialize(): Promise<void>;

  /** Runtime name/identifier */
  name: string;

  /** Languages supported by this runtime */
  supportedLanguages: Array<SupportedLanguage>;
}

/**
 * WASM execution context interface for isolated code execution
 */
export interface WasmContext {
  /**
   * Execute code in this context
   */
  execute(code: string): Promise<ExecutionResult>;

  /** Context identifier */
  id: string;

  /**
   * List files in the context
   */
  listFiles(): Promise<Array<string>>;

  /**
   * Mount a file into the context
   */
  mountFile(name: string, content: string | Uint8Array): Promise<void>;

  /**
   * Read a file from the context
   */
  readFile(name: string): Promise<Uint8Array>;
}

/**
 * Options for WASM runtime execution
 */
export interface WasmRuntimeOptions {
  /** Shared array buffer for interruption signaling */
  interruptBuffer?: SharedArrayBuffer;
  /** Memory limit in megabytes */
  memoryLimitMb?: number;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}
