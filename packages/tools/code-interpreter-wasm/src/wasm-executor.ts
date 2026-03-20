import { getErrorMessage } from "@obsku/framework";
import { PyodideRuntime } from "./runtimes/pyodide";
import { QuickJSRuntime } from "./runtimes/quickjs";
import { DEFAULT_TIMEOUT_MS } from "./runtimes/wasm-shared";
import type { WasmContext, WasmRuntime } from "./runtimes/types";
import type {
  CodeExecutor,
  ExecutionOptions,
  ExecutionResult,
  SessionOptions,
  SupportedLanguage,
  WasmExecutionOptions,
} from "@obsku/tool-code-interpreter";

type WasmSession = {
  context: WasmContext;
  id: string;
  language: SupportedLanguage;
  runtime: WasmRuntime;
};

function normalizeExecutionError(error: unknown): ExecutionResult {
  const message = getErrorMessage(error);
  return {
    executionTimeMs: 0,
    exitCode: 1,
    stderr: message,
    stdout: "",
    success: false,
  };
}

export class WasmExecutor implements CodeExecutor {
  readonly name = "wasm";
  readonly supportedLanguages: Array<SupportedLanguage> = ["python", "javascript", "typescript"];

  private quickJSRuntime: QuickJSRuntime;
  private pyodideRuntime: PyodideRuntime;
  private sessions = new Map<string, WasmSession>();
  private maxConcurrentSessions: number;
  private inputFileKeys = new WeakMap<Map<string, string | Uint8Array>, Array<string>>();

  constructor(options?: { maxConcurrentSessions?: number }) {
    this.maxConcurrentSessions = options?.maxConcurrentSessions ?? 10;
    this.quickJSRuntime = new QuickJSRuntime();
    this.pyodideRuntime = new PyodideRuntime();
  }

  async initialize(): Promise<void> {
    await Promise.all([this.quickJSRuntime.initialize(), this.pyodideRuntime.initialize()]);
  }

  async execute(options: ExecutionOptions): Promise<ExecutionResult> {
    try {
      const runtime = this.runtimeForLanguage(options.language);
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const wasmOptions: WasmExecutionOptions = {
        ...options,
      };
      const inputFiles = this.normalizeInputFiles(options.inputFiles);

      if (options.sessionId) {
        return await this.executeInSession(options.sessionId, options, runtime);
      }

      if (inputFiles) {
        const context = await runtime.createContext("__temp__");
        try {
          await this.mountInputFiles(context, inputFiles);
          const result = await this.executeInContext(context, options);
          this.excludeInputFiles(result, inputFiles);
          return result;
        } finally {
          await runtime.destroyContext("__temp__");
        }
      }

      // No session, no input files — stateless single-shot execution.
      // TypeScript is handled by the QuickJS runtime's own transpiler (Bun.Transpiler).
      const result = await runtime.execute(options.code, {
        interruptBuffer: wasmOptions.interruptOnTimeout ? new SharedArrayBuffer(4) : undefined,
        memoryLimitMb: wasmOptions.memoryLimitMb,
        timeoutMs,
      });
      if (result.outputFiles && inputFiles) {
        this.excludeInputFiles(result, inputFiles);
      }
      return result;
    } catch (error: unknown) {
      return normalizeExecutionError(error);
    }
  }

  // ── Session lifecycle ──────────────────────────────────────────────────────────
  // createSession allocates a named WASM context (Pyodide globals dict or QuickJS
  // context) that persists between execute() calls sharing the same sessionId.
  // destroySession disposes the context and releases its WASM memory.
  async createSession(id: string, opts: SessionOptions): Promise<void> {
    if (this.sessions.has(id)) {
      throw new Error(`Session ${id} already exists`);
    }

    if (this.sessions.size >= this.maxConcurrentSessions) {
      throw new Error("Max concurrent sessions exceeded");
    }

    const runtime = this.runtimeForLanguage(opts.language);
    const context = await runtime.createContext(id);
    this.sessions.set(id, {
      context,
      id,
      language: opts.language,
      runtime,
    });
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }
    await session.runtime.destroyContext(id);
    this.sessions.delete(id);
  }

  async dispose(): Promise<void> {
    for (const id of Array.from(this.sessions.keys())) {
      await this.destroySession(id);
    }
    await Promise.all([this.quickJSRuntime.dispose(), this.pyodideRuntime.dispose()]);
  }

  private runtimeForLanguage(language: SupportedLanguage): WasmRuntime {
    if (language === "python") {
      return this.pyodideRuntime;
    }
    return this.quickJSRuntime;
  }


  private async executeInSession(
    sessionId: string,
    options: ExecutionOptions,
    runtime: WasmRuntime
  ): Promise<ExecutionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return normalizeExecutionError(new Error(`Session ${sessionId} not found`));
    }

    if (session.runtime !== runtime) {
      return normalizeExecutionError(
        new Error(`Session ${sessionId} language mismatch: ${session.language}`)
      );
    }

    if (options.inputFiles) {
      await this.mountInputFiles(session.context, options.inputFiles);
    }

    const result = await this.executeInContext(session.context, options);
    if (options.inputFiles) {
      this.excludeInputFiles(result, options.inputFiles);
    }
    return result;
  }

  private async executeInContext(
    context: WasmContext,
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    // Delegate to the runtime; TypeScript is handled by QuickJS's own Bun.Transpiler.
    return context.execute(options.code);
  }

  private async mountInputFiles(
    context: WasmContext,
    inputFiles: Map<string, string | Uint8Array>
  ): Promise<void> {
    for (const [name, content] of inputFiles) {
      await context.mountFile(name, content);
    }
  }

  private normalizeInputFiles(
    inputFiles?: Map<string, string | Uint8Array>
  ): Map<string, string | Uint8Array> | undefined {
    if (!inputFiles) {
      return undefined;
    }
    const keys = Array.from(inputFiles.keys());
    this.inputFileKeys.set(inputFiles, keys);
    return inputFiles;
  }

  private excludeInputFiles(
    result: ExecutionResult,
    inputFiles: Map<string, string | Uint8Array>
  ): void {
    if (!result.outputFiles) {
      return;
    }
    const keys = this.inputFileKeys.get(inputFiles);
    if (keys) {
      for (const key of keys) {
        result.outputFiles.delete(key);
      }
    } else {
      // Fallback when inputFiles not tracked (e.g., from executeInSession)
      for (const key of inputFiles.keys()) {
        result.outputFiles.delete(key);
      }
    }
    if (result.outputFiles.size === 0) {
      result.outputFiles = undefined;
    }
}

}