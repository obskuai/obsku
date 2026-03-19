/**
 * Characterization tests for Pyodide output-recovery failure paths and
 * stderr propagation behavior.
 *
 * Purpose (Wave 1 / Task 5): Pin current user-visible stderr/stdout shapes
 * so Wave-3 observability improvements cannot accidentally change the
 * observable output contract.
 *
 * Key paths exercised:
 *  A) Happy-path stderr: Python code writes to stderr → captured correctly.
 *  B) Error-path stderr: Python exception → traceback appended to stderr.
 *  C) Recovery-failure path: _obsku_stdout deleted before exception →
 *       inner recoverOutput() throws → Warning sentinel is prepended.
 *  D) Non-Error JS exception: String thrown by pyodide edge case → stringified.
 *
 * Rules:
 *  - Tests are READ-ONLY observers; production source files are NOT modified.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PyodideRuntime } from "../src/runtimes/pyodide";

describe("recovery failure characterization", () => {
  let runtime: PyodideRuntime;

  beforeAll(async () => {
    runtime = new PyodideRuntime();
    await runtime.initialize();
  });

  afterAll(async () => {
    await runtime.dispose();
  });

  // -------------------------------------------------------------------------
  // A) Happy-path: explicit Python stderr write is captured
  // -------------------------------------------------------------------------
  test("explicit sys.stderr.write is captured in result.stderr", async () => {
    const result = await runtime.execute("import sys\nsys.stderr.write('explicit-error\\n')");

    // Pin: Python-layer stderr always takes precedence (StringIO recovery path)
    expect(result.success).toBe(true);
    expect(result.stderr).toContain("explicit-error");
  });

  test("print() to stderr via file= kwarg is captured", async () => {
    const result = await runtime.execute("import sys\nprint('print-stderr', file=sys.stderr)");

    expect(result.success).toBe(true);
    expect(result.stderr).toContain("print-stderr");
  });

  // -------------------------------------------------------------------------
  // B) Error-path: Python exceptions → stderr gets traceback text
  // -------------------------------------------------------------------------
  test("ZeroDivisionError traceback appears in stderr on failure", async () => {
    const result = await runtime.execute("1/0");

    // Pin: failure sets success=false and exitCode=1
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);

    // Pin: the exception class name is always present in stderr
    expect(result.stderr).toContain("ZeroDivisionError");
  });

  test("NameError traceback appears in stderr", async () => {
    const result = await runtime.execute("print(undefined_variable)");

    expect(result.success).toBe(false);
    expect(result.stderr).toContain("NameError");
  });

  test("custom RuntimeError message is included in stderr", async () => {
    const result = await runtime.execute('raise RuntimeError("sentinel-error-message")');

    expect(result.success).toBe(false);
    expect(result.stderr).toContain("RuntimeError");
    expect(result.stderr).toContain("sentinel-error-message");
  });

  test("stdout captured before error is preserved when execution fails", async () => {
    // Print before raising so we can confirm stdout is NOT lost when
    // the error-recovery path runs.
    const result = await runtime.execute('print("before-crash")\nraise ValueError("after-print")');

    expect(result.success).toBe(false);
    // Pin: partial stdout written before the error is still returned
    expect(result.stdout).toContain("before-crash");
    expect(result.stderr).toContain("ValueError");
  });

  test("SyntaxError is reported in stderr", async () => {
    const result = await runtime.execute("def broken(\n");

    expect(result.success).toBe(false);
    expect(result.stderr).toContain("SyntaxError");
  });

  // -------------------------------------------------------------------------
  // C) Recovery-failure path: _obsku_stdout deleted → Warning sentinel
  //
  // When Python code deletes the internal StringIO capture variable before
  // raising an exception, recoverOutput() cannot access the buffer and the
  // inner catch appends the Warning sentinel.
  // -------------------------------------------------------------------------
  test("deleting _obsku_stdout before raise triggers Warning sentinel in stderr", async () => {
    // This exercises the inner `catch { capture.appendStderr("Warning: ...") }` path
    // at pyodide.ts:257.
    const result = await runtime.execute(
      'del _obsku_stdout\nraise RuntimeError("forced-recovery-failure")'
    );

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);

    // Pin: the Warning sentinel is emitted when recoverOutput() fails
    expect(result.stderr).toContain("Warning: Failed to capture output (execution failed early)");
  });

  test("recovery-failure stderr contains ONLY Warning sentinel (error message is silently dropped)", async () => {
    // OBSERVABILITY GAP (Wave 3 target): When recoverOutput() fails,
    // pyodide.ts:262 appends error.message — but in practice the PythonError
    // message is falsy for this path, so the original error string is lost.
    // This test pins the CURRENT behavior so Wave-3 improvements can be
    // validated as non-breaking API changes.
    const result = await runtime.execute(
      'del _obsku_stdout\nraise RuntimeError("recovery-fail-msg")'
    );

    expect(result.success).toBe(false);

    // Pin: Warning sentinel IS present
    expect(result.stderr).toContain("Warning: Failed to capture output (execution failed early)");

    // Pin: error message is silently dropped (observability gap — fix in Wave 3).
    // When Wave 3 improves this, update the assertion to toContain() instead.
    expect(result.stderr).not.toContain("recovery-fail-msg");
  });

  test("stdout is empty when _obsku_stdout is deleted before output", async () => {
    const result = await runtime.execute(
      'del _obsku_stdout\nraise RuntimeError("no-stdout-expected")'
    );

    // Pin: when recovery fails, JS-side stdout buffer starts at "" (no writes
    // happened before the delete), so stdout is empty.
    expect(result.stdout).toBe("");
  });

  // -------------------------------------------------------------------------
  // D) Stderr propagation: mixed stdout + stderr
  // -------------------------------------------------------------------------
  test("both stdout and stderr are returned when code mixes print and stderr", async () => {
    const result = await runtime.execute(
      "import sys\nprint('out-line')\nsys.stderr.write('err-line\\n')"
    );

    expect(result.success).toBe(true);
    expect(result.stdout).toContain("out-line");
    expect(result.stderr).toContain("err-line");
  });

  test("multiple stderr writes are concatenated in order", async () => {
    const result = await runtime.execute(
      "import sys\nsys.stderr.write('first\\n')\nsys.stderr.write('second\\n')"
    );

    expect(result.success).toBe(true);
    // Pin: writes are concatenated; both appear and first precedes second
    const idx1 = result.stderr.indexOf("first");
    const idx2 = result.stderr.indexOf("second");
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThan(idx1);
  });

  // -------------------------------------------------------------------------
  // E) Empty-output baseline (no regression guard)
  // -------------------------------------------------------------------------
  test("code with no output produces empty stdout and stderr on success", async () => {
    const result = await runtime.execute("x = 1 + 1");

    expect(result.success).toBe(true);
    // Pin: silent code produces truly empty strings (not undefined/null)
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});
