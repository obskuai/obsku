import type { ExecutionResult, SupportedLanguage } from "@obsku/tool-code-interpreter";
import { loadPyodide, type PyodideInterface } from "pyodide";
import { createWasmWorkspace } from "../wasm-workspace";
import { AbstractWasmRuntime } from "./abstract-wasm-runtime";
import {
  executePyodideRun,
  mountPyodideWorkspace,
  type PyodideContextState,
} from "./pyodide-execution";
import type { WasmRuntimeOptions } from "./types";
import { runWasmExecution } from "./wasm-shared";

async function runSerialized<T>(
  state: PyodideContextState,
  operation: () => Promise<T>
): Promise<T> {
  const previous = state.executionChain;
  let release!: () => void;
  state.executionChain = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

/**
 * Pyodide WASM runtime — Python execution via Pyodide (CPython compiled to WASM).
 *
 * Lifecycle
 * ─────────
 *   initialize()         →  loadPyodide() once; stored as sharedPyodide.
 *   createRuntimeState  →  creates per-context workspace + globals PyProxy.
 *   executeInContext    →  per-call: mount FS, reset IO capture, run code,
 *                          recover output, sync workspace back to real FS.
 *   destroyRuntimeState →  destroy the globals PyProxy (frees WASM memory),
 *                          clean up workspace.
 *
 * Stdio capture (two layers per execution)
 * ───────────────────────────────────────
 *   1. JS-side (secondary): pyodide.setStdout/setStderr — catches C-level I/O.
 *   2. Python-side (primary): sys.stdout/stderr redirected to StringIO via
 *      CAPTURE_SETUP, reset at the start of every call.
 *   recoverOutput() reads the StringIO values and overwrites the JS-side buffers
 *   so Python-layer output always wins.
 *
 * Edge cases
 * ──────────
 *   - interruptBuffer[0]=2 signals KeyboardInterrupt; Pyodide polls inside
 *     runPythonAsync and raises the exception when the timeout fires.
 *   - KeyboardInterrupt in stderr is mapped to isTimeout=true.
 *   - exec(compile(..., "exec"), globals()) puts user assignments in the shared
 *     globals dict — matching normal Python script (not function) semantics.
 */
export class PyodideRuntime extends AbstractWasmRuntime<PyodideContextState> {
  readonly name = "pyodide";
  readonly supportedLanguages: Array<SupportedLanguage> = ["python"];

  // Shared Pyodide instance — loaded once in initialize() and reused across
  // all contexts. Each context gets its own globals dict + workspace directory
  // for isolation; the WASM module itself is shared to avoid the ~12s load cost
  // per context.
  private sharedPyodide?: PyodideInterface;

  override async initialize(): Promise<void> {
    this.sharedPyodide = await loadPyodide();
  }

  protected async createRuntimeState(id: string): Promise<PyodideContextState> {
    // LIFECYCLE — Session start: reuse the shared Pyodide instance, create a
    // per-context workspace and globals dict that persists across calls.
    const pyodide = this.sharedPyodide ?? (this.sharedPyodide = await loadPyodide());
    const workspace = await createWasmWorkspace();
    const globals = pyodide.toPy({});
    return { executionChain: Promise.resolve(), globals, id, pyodide, workspace };
  }

  protected async destroyRuntimeState(state: PyodideContextState): Promise<void> {
    // LIFECYCLE — Session shutdown: release the globals PyProxy to free WASM
    // memory, then delete temp workspace files.
    state.globals?.destroy?.();
    await state.workspace.cleanup();
  }

  protected async executeInContext(
    state: PyodideContextState,
    code: string,
    options: WasmRuntimeOptions
  ): Promise<ExecutionResult> {
    return runSerialized(state, async () => {
      if (options.interruptBuffer && options.interruptBuffer.byteLength < 4) {
        throw new Error("interruptBuffer must be at least 4 bytes");
      }
      const interruptBufferRaw = options.interruptBuffer ?? new SharedArrayBuffer(4);
      const interruptBuffer = new Uint8Array(interruptBufferRaw);
      interruptBuffer[0] = 0;
      return runWasmExecution(state.workspace, options, async (execState, timeoutMs) => {
        await mountPyodideWorkspace(state);
        await executePyodideRun({ code, execState, interruptBuffer, state, timeoutMs });
      });
    });
  }
}
