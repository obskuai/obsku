import { describe, expect, test } from "bun:test";
import { ExecCancelledError, ExecTimeoutError, execCmd } from "../src/exec";

describe("ExecTimeoutError", () => {
  test("creates error with correct message", () => {
    const error = new ExecTimeoutError("test-cmd", 5000);
    expect(error.message).toBe('Command "test-cmd" timed out after 5000ms');
    expect(error.name).toBe("ExecTimeoutError");
    expect(error._tag).toBe("ExecTimeoutError");
    expect(error.cmd).toBe("test-cmd");
    expect(error.timeoutMs).toBe(5000);
  });
});

describe("ExecCancelledError", () => {
  test("should extend Error", () => {
    const error = new ExecCancelledError();
    expect(error).toBeInstanceOf(Error);
  });

  test("should be instanceof ExecCancelledError", () => {
    const error = new ExecCancelledError();
    expect(error).toBeInstanceOf(ExecCancelledError);
  });

  test("should have correct _tag", () => {
    const error = new ExecCancelledError();
    expect(error._tag).toBe("ExecCancelledError");
  });

  test("should have correct name", () => {
    const error = new ExecCancelledError();
    expect(error.name).toBe("ExecCancelledError");
  });

  test("should have correct message format", () => {
    const error = new ExecCancelledError();
    expect(error.message).toBe("Process aborted by cancellation signal");
  });

  test("should contain 'Process aborted' substring for test compatibility", () => {
    const error = new ExecCancelledError();
    expect(() => {
      throw error;
    }).toThrow("Process aborted");
  });
});

describe("execCmd", () => {
  test("executes command and captures stdout", async () => {
    const controller = new AbortController();
    const result = await execCmd("echo", ["hello"], {}, controller.signal);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
  });

  test("captures stderr and non-zero exit code", async () => {
    const controller = new AbortController();
    const result = await execCmd("sh", ["-c", "echo error >&2; exit 42"], {}, controller.signal);

    expect(result.exitCode).toBe(42);
    expect(result.stderr).toContain("error");
  });

  test("throws ExecTimeoutError when timeout exceeded", async () => {
    const controller = new AbortController();

    await expect(
      execCmd("sleep", ["10"], { timeout: 10 }, controller.signal)
    ).rejects.toBeInstanceOf(ExecTimeoutError);
  });

  test("throws error when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(execCmd("echo", ["hello"], {}, controller.signal)).rejects.toBeInstanceOf(
      ExecTimeoutError
    );
  });

  test("respects cwd option", async () => {
    const controller = new AbortController();
    const result = await execCmd("pwd", [], { cwd: "/tmp" }, controller.signal);

    expect(result.stdout.trim()).toBe("/tmp");
  });

  test("respects env option", async () => {
    const controller = new AbortController();
    const result = await execCmd(
      "sh",
      ["-c", "echo $TEST_VAR"],
      {
        env: { TEST_VAR: "test-value" },
      },
      controller.signal
    );

    expect(result.stdout.trim()).toBe("test-value");
  });
});
