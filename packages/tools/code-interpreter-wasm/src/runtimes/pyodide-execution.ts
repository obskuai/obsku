import type { PyodideInterface } from "pyodide";
import type { PyProxy } from "pyodide/ffi";
import { getErrorMessage } from "@obsku/framework";
import { createWasmWorkspace, mkdirSafe } from "../wasm-workspace";
import type { WasmExecutionState } from "./wasm-shared";

export type PyodideGlobals = PyProxy;

export interface PyodideContextState {
  executionChain: Promise<void>;
  globals: PyodideGlobals;
  id: string;
  pyodide: PyodideInterface;
  workspace: Awaited<ReturnType<typeof createWasmWorkspace>>;
}

interface CaptureBuffer {
  appendStderr(value: string): void;
  getStderr(): string;
  getStdout(): string;
  setStderr(value: string): void;
  setStdout(value: string): void;
}

interface PyodideTimeoutRunOptions {
  code: string;
  globals: PyodideGlobals;
  interruptBuffer: Uint8Array;
  pyodide: PyodideInterface;
  timeoutMs: number;
}

interface PyodideRunOptions {
  code: string;
  execState: WasmExecutionState;
  interruptBuffer: Uint8Array;
  state: PyodideContextState;
  timeoutMs: number;
}

const CAPTURE_SETUP = `
import sys
from io import StringIO
_obsku_stdout = StringIO()
_obsku_stderr = StringIO()
sys.stdout = _obsku_stdout
sys.stderr = _obsku_stderr
`;

export async function mountPyodideWorkspace(state: PyodideContextState): Promise<void> {
  mkdirSafe(state.pyodide.FS, "/wasm-workspace");
  mkdirSafe(state.pyodide.FS, state.workspace.dir);
  await state.workspace.mountToEmscriptenFS(state.pyodide.FS);
  state.pyodide.FS.chdir(state.workspace.dir);
}

export async function executePyodideRun({
  code,
  execState,
  interruptBuffer,
  state,
  timeoutMs,
}: PyodideRunOptions): Promise<void> {
  const capture = setupCapture(state.pyodide);

  try {
    const runResult = await runPyodideWithTimeout({
      code,
      globals: state.globals,
      interruptBuffer,
      pyodide: state.pyodide,
      timeoutMs,
    });

    execState.isTimeout = runResult.isTimeout;
    if (runResult.error) {
      throw runResult.error;
    }

    await overwriteCaptureWithRecoveredOutput(state.pyodide, state.globals, capture);
  } catch (error: unknown) {
    await handlePyodideExecutionFailure({
      capture,
      error,
      execState,
      globals: state.globals,
      pyodide: state.pyodide,
    });
  } finally {
    await syncWorkspaceFromPyodide(state);
  }

  syncExecutionStateFromCapture(execState, capture);
}

function setupCapture(pyodide: PyodideInterface): CaptureBuffer {
  let stdout = "";
  let stderr = "";

  pyodide.setStdout({
    batched: (text: string) => {
      stdout += text;
    },
  });

  pyodide.setStderr({
    batched: (text: string) => {
      stderr += text;
    },
  });

  return {
    appendStderr: (value: string) => {
      stderr += value;
    },
    getStderr: () => stderr,
    getStdout: () => stdout,
    setStderr: (value: string) => {
      stderr = value;
    },
    setStdout: (value: string) => {
      stdout = value;
    },
  };
}

async function runPyodideWithTimeout({
  code,
  globals,
  interruptBuffer,
  pyodide,
  timeoutMs,
}: PyodideTimeoutRunOptions): Promise<{ error?: unknown; isTimeout: boolean }> {
  let isTimeout = false;
  const timer = setTimeout(() => {
    isTimeout = true;
    interruptBuffer[0] = 2;
  }, timeoutMs);

  try {
    pyodide.setInterruptBuffer(interruptBuffer);
    await pyodide.runPythonAsync(CAPTURE_SETUP, { globals });

    const wrapped = `
import traceback
__obsku_code = ${JSON.stringify(code)}
try:
    exec(compile(__obsku_code, "<exec>", "exec"), globals())
except KeyboardInterrupt:
    import sys
    sys.stderr.write("KeyboardInterrupt\\n")
except Exception:
    traceback.print_exc()
    raise
`;
    await pyodide.runPythonAsync(wrapped, { globals });
    return { isTimeout };
  } catch (error: unknown) {
    return { error, isTimeout };
  } finally {
    clearTimeout(timer);
  }
}

async function overwriteCaptureWithRecoveredOutput(
  pyodide: PyodideInterface,
  globals: PyodideGlobals,
  capture: CaptureBuffer
): Promise<void> {
  const recovered = await recoverPyodideOutput(pyodide, globals);
  if (recovered.stdout !== undefined) {
    capture.setStdout(recovered.stdout);
  }
  if (recovered.stderr !== undefined) {
    capture.setStderr(recovered.stderr);
  }
}

async function handlePyodideExecutionFailure({
  capture,
  error,
  execState,
  globals,
  pyodide,
}: {
  capture: CaptureBuffer;
  error: unknown;
  execState: WasmExecutionState;
  globals: PyodideGlobals;
  pyodide: PyodideInterface;
}): Promise<void> {
  execState.exitCode = 1;

  try {
    await overwriteCaptureWithRecoveredOutput(pyodide, globals, capture);
  } catch (recoveryError) {
    capture.appendStderr(
      `Warning: Failed to capture output (execution failed early): ${getErrorMessage(recoveryError)}\n`
    );
  }

  if (execState.isTimeout) {
    capture.setStderr(capture.getStderr() || "Execution timed out");
    return;
  }

  if (error instanceof Error) {
    capture.appendStderr(error.message ? `${error.message}\n` : "");
    return;
  }

  capture.appendStderr(String(error));
}

async function recoverPyodideOutput(
  pyodide: PyodideInterface,
  globals: PyodideGlobals
): Promise<{ stderr?: string; stdout?: string }> {
  const captureProxy = await pyodide.runPythonAsync(
    "(_obsku_stdout.getvalue(), _obsku_stderr.getvalue())",
    { globals }
  );
  const [capturedOut, capturedErr] = captureProxy.toJs();
  captureProxy.destroy();

  return {
    stderr: typeof capturedErr === "string" ? capturedErr : undefined,
    stdout: typeof capturedOut === "string" ? capturedOut : undefined,
  };
}

async function syncWorkspaceFromPyodide(state: PyodideContextState): Promise<void> {
  await state.workspace.syncFromEmscriptenFS(state.pyodide.FS, state.workspace.dir);
}

function syncExecutionStateFromCapture(
  execState: WasmExecutionState,
  capture: CaptureBuffer
): void {
  if (capture.getStderr().includes("KeyboardInterrupt")) {
    execState.isTimeout = true;
    execState.exitCode = 1;
  }

  execState.stdout = capture.getStdout();
  execState.stderr = capture.getStderr();
}
