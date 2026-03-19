/**
 * Type tests for WASM execution types
 * This file validates type assignability and extension
 */

import type { WasmContext, WasmRuntime, WasmRuntimeOptions } from "./runtimes/types";
import type {
  ExecutionOptions,
  ExecutionResult,
  SupportedLanguage,
  WasmExecutionOptions,
} from "./types";

// Test 1: WasmExecutionOptions extends ExecutionOptions
const baseOptions: ExecutionOptions = {
  code: "print('hello')",
  language: "python" as SupportedLanguage,
};

const wasmOptions: WasmExecutionOptions = {
  ...baseOptions,
  interruptOnTimeout: true,
  memoryLimitMb: 128,
};

// Test 2: WasmExecutionOptions is assignable to ExecutionOptions (structural typing)
const _assignable: ExecutionOptions = wasmOptions;

// Test 3: WasmRuntime interface structure type check
const _runtimeShape: WasmRuntime = {
  createContext: async (_id: string): Promise<WasmContext> => ({
    execute: async (_code: string): Promise<ExecutionResult> => ({
      executionTimeMs: 0,
      stderr: "",
      stdout: "",
      success: true,
    }),
    id: _id,
    listFiles: async (): Promise<Array<string>> => [],
    mountFile: async (_name: string, _content: string | Uint8Array) => {},
    readFile: async (_name: string): Promise<Uint8Array> => new Uint8Array(),
  }),
  destroyContext: async (_id: string) => {},
  dispose: async () => {},
  execute: async (_code: string, _options?: WasmRuntimeOptions): Promise<ExecutionResult> => ({
    executionTimeMs: 0,
    stderr: "",
    stdout: "",
    success: true,
  }),
  initialize: async () => {},
  name: "test-wasm",
  supportedLanguages: ["python"],
};

// Test 4: WasmRuntimeOptions optional fields
type RuntimeOptionsCheck = Required<WasmRuntimeOptions>;
type _Check1 = RuntimeOptionsCheck["memoryLimitMb"] extends number ? true : never;
type _Check2 = RuntimeOptionsCheck["timeoutMs"] extends number ? true : never;
type _Check3 = RuntimeOptionsCheck["interruptBuffer"] extends SharedArrayBuffer ? true : never;

// Test 5: Backward compatibility - ExecutionOptions without WASM fields
const _legacyOptions: ExecutionOptions = {
  code: "console.log('test')",
  language: "javascript",
  timeoutMs: 5000,
};
