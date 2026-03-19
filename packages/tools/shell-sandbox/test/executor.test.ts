import { describe, expect, test } from "bun:test";
import { SandboxedShellExecutor } from "../src/executor";

describe("SandboxedShellExecutor", () => {
  test("basic execution: echo hello → stdout, exitCode 0, timedOut false", async () => {
    const executor = new SandboxedShellExecutor({ fs: "memory" });
    try {
      const result = await executor.execute({ command: "echo hello" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello");
      expect(result.stderr).toBe("");
      expect(result.timedOut).toBe(false);
    } finally {
      await executor.dispose();
    }
  });

  test("pipes: echo hello | cat → stdout hello", async () => {
    const executor = new SandboxedShellExecutor({ fs: "memory" });
    try {
      const result = await executor.execute({ command: "echo hello | cat" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello");
    } finally {
      await executor.dispose();
    }
  });

  test("stderr: echo error >&2 → captured in stderr", async () => {
    const executor = new SandboxedShellExecutor({ fs: "memory" });
    try {
      const result = await executor.execute({ command: "echo error >&2" });
      expect(result.stderr).toContain("error");
    } finally {
      await executor.dispose();
    }
  });

  test("exit codes: exit 42 → exitCode 42", async () => {
    const executor = new SandboxedShellExecutor({ fs: "memory" });
    try {
      const result = await executor.execute({ command: "exit 42" });
      expect(result.exitCode).toBe(42);
    } finally {
      await executor.dispose();
    }
  });

  test("FS isolation: files not shared between executor calls", async () => {
    const executor = new SandboxedShellExecutor({ fs: "memory" });
    try {
      // Write file in first call
      await executor.execute({ command: "echo hello > /tmp/test.txt" });
      // Second call gets a fresh InMemoryFs — file should not exist
      const result = await executor.execute({ command: "cat /tmp/test.txt" });
      expect(result.exitCode).not.toBe(0);
    } finally {
      await executor.dispose();
    }
  });

  test("timeout: sleep 30 with 500ms timeout → timedOut true, exitCode -1", async () => {
    const executor = new SandboxedShellExecutor({ fs: "memory", timeoutMs: 500 });
    try {
      const result = await executor.execute({ command: "sleep 30" });
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(-1);
    } finally {
      await executor.dispose();
    }
  }, 5000);

  test("built-in: jq -n '{\"a\":1}' → valid JSON output", async () => {
    const executor = new SandboxedShellExecutor({ fs: "memory" });
    try {
      const result = await executor.execute({ command: "jq -n '{\"a\":1}'" });
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
      expect(parsed).toHaveProperty("a");
      expect(parsed.a).toBe(1);
    } finally {
      await executor.dispose();
    }
  });

  test("built-in: echo test | grep test → stdout contains test", async () => {
    const executor = new SandboxedShellExecutor({ fs: "memory" });
    try {
      const result = await executor.execute({ command: "echo test | grep test" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("test");
    } finally {
      await executor.dispose();
    }
  });

  test("environment variables: custom env available in command", async () => {
    const executor = new SandboxedShellExecutor({ fs: "memory" });
    try {
      const result = await executor.execute({
        command: "echo $MY_VAR",
        env: { MY_VAR: "hello_world" },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello_world");
    } finally {
      await executor.dispose();
    }
  });

  test("error handling: invalid command → exitCode !== 0", async () => {
    const executor = new SandboxedShellExecutor({ fs: "memory" });
    try {
      const result = await executor.execute({ command: "nonexistent_command_xyz_abc" });
      expect(result.exitCode).not.toBe(0);
    } finally {
      await executor.dispose();
    }
  });

  test("dispose: subsequent execute returns error result", async () => {
    const executor = new SandboxedShellExecutor({ fs: "memory" });
    await executor.dispose();
    const result = await executor.execute({ command: "echo hello" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain("disposed");
    expect(result.timedOut).toBe(false);
  });

  test("timeout override: per-call timeout takes precedence over executor default", async () => {
    // Executor has no timeout; per-call timeout should still trigger
    const executor = new SandboxedShellExecutor({ fs: "memory" });
    try {
      const result = await executor.execute({ command: "sleep 30", timeoutMs: 500 });
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(-1);
    } finally {
      await executor.dispose();
    }
  }, 5000);
});
