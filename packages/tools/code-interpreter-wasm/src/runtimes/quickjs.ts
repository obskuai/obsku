import type {
  QuickJSContext as QuickJSContextHandle,
  QuickJSHandle,
  QuickJSRuntime as QuickJSRuntimeHandle,
  QuickJSWASMModule,
} from "quickjs-emscripten";
import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";
import type { ExecutionResult, SupportedLanguage } from "@obsku/tool-code-interpreter";
import { createWasmWorkspace } from "../wasm-workspace";
import { AbstractWasmRuntime } from "./abstract-wasm-runtime";
import type { WasmRuntimeOptions } from "./types";
import { runWasmExecution } from "./wasm-shared";

interface QuickJSContextState {
  context: QuickJSContextHandle;
  id: string;
  runtime: QuickJSRuntimeHandle;
  workspace: Awaited<ReturnType<typeof createWasmWorkspace>>;
}

const DEFAULT_MEMORY_LIMIT_MB = 256;

function disposeHandle(handle?: QuickJSHandle | null): void {
  if (!handle) {
    return;
  }
  handle.dispose();
}

function safeDump(context: QuickJSContextHandle, handle: QuickJSHandle): string {
  try {
    const value = context.dump(handle);
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

/**
 * QuickJS WASM runtime — JavaScript/TypeScript execution via quickjs-emscripten.
 *
 * Lifecycle
 * ─────────
 *   initialize          →  lazy load of the QuickJS WASM module (once per runtime
 *                          instance, shared across all contexts).
 *   createRuntimeState  →  new QuickJSRuntime + QuickJSContext per session;
 *                          these are separate objects — runtime owns memory,
 *                          context provides the eval API.
 *   executeInContext    →  per-call: transpile TS→JS, set memory limit + deadline
 *                          interrupt handler, install console shim, eval code.
 *   destroyRuntimeState →  dispose context THEN runtime (order matters: context
 *                          holds live references into the runtime), cleanup workspace.
 *
 * Stdio capture
 * ─────────────
 *   installConsole() replaces the QuickJS global console before every evalCode().
 *   The log/error handlers close over per-call callbacks so each execution
 *   gets isolated stdout/stderr buffers.
 *
 * Edge cases
 * ──────────
 *   - Interrupt:      shouldInterruptAfterDeadline(deadline) is set on the runtime
 *                     and removed in finally to prevent stale interrupt handlers.
 *   - Memory limit:   runtime.setMemoryLimit() applied per call.
 *   - TypeScript:     Bun.Transpiler strips type annotations before eval.
 *   - Timeout detect: checked in both catch (interrupt error text) and finally
 *                     (wall-clock) to cover all interrupt code paths.
 */
export class QuickJSRuntime extends AbstractWasmRuntime<QuickJSContextState> {
  readonly name = "quickjs";
  readonly supportedLanguages: Array<SupportedLanguage> = ["javascript", "typescript"];

  private module?: QuickJSWASMModule;
  private transpiler = new Bun.Transpiler({ loader: "ts" });

  override async initialize(): Promise<void> {
    if (this.module) {
      return;
    }
    this.module = await getQuickJS();
  }

  protected async createRuntimeState(id: string): Promise<QuickJSContextState> {
    // LIFECYCLE — Session start: ensure the QuickJS WASM module is loaded, then
    // create a fresh runtime + context pair and a per-context workspace.
    await this.initialize();
    if (!this.module) {
      throw new Error("QuickJS module not initialized");
    }
    const runtime = this.module.newRuntime();
    const context = runtime.newContext();
    const workspace = await createWasmWorkspace();
    return { context, id, runtime, workspace };
  }

  protected async destroyRuntimeState(state: QuickJSContextState): Promise<void> {
    // LIFECYCLE — Session shutdown: dispose context before runtime (context holds
    // live references into the runtime object), then clean up workspace.
    state.context.dispose();
    state.runtime.dispose();
    await state.workspace.cleanup();
  }

  protected async executeInContext(
    state: QuickJSContextState,
    code: string,
    options: WasmRuntimeOptions
  ): Promise<ExecutionResult> {
    const context = state.context;
    const runtime = state.runtime;
    const memoryLimitMb = options.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;
    return runWasmExecution(state.workspace, options, async (execState, timeoutMs) => {
      // Phase 1: transpile TypeScript → JavaScript (Bun.Transpiler; no-op for plain JS).
      const execStart = Date.now();
      try {
        const jsCode = this.transpiler.transformSync(code);
        // Phase 2: apply memory cap and deadline interrupt (edge cases: memory OOM
        //          surfaces as a thrown exception; deadline fires via interrupt handler).
        runtime.setMemoryLimit(memoryLimitMb * 1024 * 1024);

        const deadline = Date.now() + timeoutMs;
        runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));

        // Phase 3: install per-call console shim for stdout/stderr capture.
        this.installConsole(
          context,
          (line) => {
            execState.stdout += line;
          },
          (line) => {
            execState.stderr += line;
          }
        );

        // Phase 4: install input files as __files__ global, then eval.
        // evalCode() returns result-or-error; errors do not throw — they are
        // returned inline so handle disposal is still guaranteed.
        this.installFiles(context, state.workspace.toQuickJSGlobals());

        const result = context.evalCode(jsCode);
        if ("error" in result && result.error) {
          const errorMessage = safeDump(context, result.error);
          execState.stderr += errorMessage;
          execState.exitCode = 1;
          disposeHandle(result.error);
        } else if ("value" in result && result.value) {
          disposeHandle(result.value);
        }
      } catch (error: unknown) {
        execState.exitCode = 1;
        if (error instanceof Error) {
          execState.stderr += error.message;
          if (error.message.toLowerCase().includes("interrupt")) {
            execState.isTimeout = true;
          }
        } else {
          execState.stderr += String(error);
        }
      } finally {
        if (Date.now() >= execStart + timeoutMs) {
          execState.isTimeout = true;
        }
        runtime.removeInterruptHandler();
      }
    });
  }

  // ── Stdio capture ────────────────────────────────────────────────────────────
  // Replaces console.log and console.error in the QuickJS global on every call.
  // Handles are disposed after being set on the global to prevent handle leaks.
  private installConsole(
    context: QuickJSContextHandle,
    onLog: (line: string) => void,
    onError: (line: string) => void
  ): void {
    const consoleHandle = context.newObject();
    const logHandle = context.newFunction("log", (...args) => {
      const output = args.map((arg) => safeDump(context, arg)).join(" ");
      onLog(output + "\n");
    });
    const errorHandle = context.newFunction("error", (...args) => {
      const output = args.map((arg) => safeDump(context, arg)).join(" ");
      onError(output + "\n");
    });

    context.setProp(consoleHandle, "log", logHandle);
    context.setProp(consoleHandle, "error", errorHandle);
    context.setProp(context.global, "console", consoleHandle);

    consoleHandle.dispose();
    logHandle.dispose();
    errorHandle.dispose();
  }

  private installFiles(context: QuickJSContextHandle, files: Record<string, Uint8Array>): void {
    const filesHandle = context.newObject();
    for (const [name, content] of Object.entries(files)) {
      const arrayBufferHandle = context.newArrayBuffer(content.buffer);
      context.setProp(filesHandle, name, arrayBufferHandle);
      arrayBufferHandle.dispose();
    }
    context.setProp(context.global, "__files__", filesHandle);
    filesHandle.dispose();
  }
}
