import { describe, expect, mock, test } from "bun:test";
import { Effect, Exit } from "effect";
import { createExec } from "../src/exec";
import type { SandboxModule, ShellBackend } from "../src/resolve-backend";

function runEffect<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromiseExit(effect);
}

function extractSuccess(exit: Exit.Exit<unknown, unknown>): unknown {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw new Error(`Expected success, got failure: ${JSON.stringify(exit.cause)}`);
}

interface PluginExecutionResult {
  isError?: boolean;
  result: string;
}

function createFakeSandboxModule(options?: {
  executeResult?: {
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
  };
  onConstruct?: (options: unknown) => void;
}) {
  const mockExecute = mock(
    async () =>
      options?.executeResult ?? {
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
      }
  );
  const mockDispose = mock(async () => {});

  class FakeSandboxedShellExecutor {
    constructor(executorOptions: unknown) {
      options?.onConstruct?.(executorOptions);
    }

    execute = mockExecute;
    dispose = mockDispose;
  }

  const module: SandboxModule = {
    SandboxedShellExecutor: FakeSandboxedShellExecutor,
    createSandboxedExec: mock(() => ({})),
    sandboxedExec: {},
  };

  return { module, mockDispose, mockExecute };
}

describe("exec-unified", () => {
  describe("local backend", () => {
    test("executes command with args using local exec", async () => {
      const execPlugin = createExec({ backend: "local" });

      const exit = await runEffect(
        execPlugin.execute({ command: "echo", args: ["hello"], timeout: 5000 })
      );
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;

      expect(wrappedResult.isError).toBe(false);
      const parsed = JSON.parse(wrappedResult.result);
      expect(parsed.exitCode).toBe(0);
      expect(parsed.stdout).toContain("hello");
    });

    test("executes command with shell flag", async () => {
      const execPlugin = createExec({ backend: "local" });

      const exit = await runEffect(
        execPlugin.execute({ command: "echo hello", shell: true, timeout: 5000 })
      );
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;

      expect(wrappedResult.isError).toBe(false);
      const parsed = JSON.parse(wrappedResult.result);
      expect(parsed.exitCode).toBe(0);
      expect(parsed.stdout).toContain("hello");
    });

    test("passes cwd to execution", async () => {
      const execPlugin = createExec({ backend: "local" });

      const exit = await runEffect(
        execPlugin.execute({ command: "pwd", cwd: "/tmp", timeout: 5000 })
      );
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;

      expect(wrappedResult.isError).toBe(false);
      const parsed = JSON.parse(wrappedResult.result);
      expect(parsed.exitCode).toBe(0);
    });
  });

  describe("sandbox backend", () => {
    test("executes command via SandboxedShellExecutor", async () => {
      const fakeSandbox = createFakeSandboxModule({
        executeResult: {
          stdout: "sandboxed output",
          stderr: "",
          exitCode: 0,
          timedOut: false,
        },
      });
      const execPlugin = createExec({
        backend: "sandbox",
        loadSandboxModule: async () => fakeSandbox.module,
      });

      const exit = await runEffect(
        execPlugin.execute({ command: "echo", args: ["hello"], timeout: 5000 })
      );
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;

      expect(wrappedResult.isError).toBe(false);
      const parsed = JSON.parse(wrappedResult.result);
      expect(parsed.stdout).toBe("sandboxed output");
      expect(fakeSandbox.mockExecute).toHaveBeenCalled();

      const callArgs = (fakeSandbox.mockExecute.mock.calls[0]?.[0] ?? null) as Record<
        string,
        unknown
      > | null;
      expect(callArgs).not.toBeNull();
      expect(callArgs?.command).toBe("echo");
      expect(callArgs?.args).toEqual(["hello"]);
    });

    test("passes cwd to SandboxedShellExecutor", async () => {
      const fakeSandbox = createFakeSandboxModule();
      const execPlugin = createExec({
        backend: "sandbox",
        loadSandboxModule: async () => fakeSandbox.module,
      });

      await runEffect(execPlugin.execute({ command: "pwd", cwd: "/workspace", timeout: 5000 }));

      const callArgs = (fakeSandbox.mockExecute.mock.calls[0]?.[0] ?? null) as Record<
        string,
        unknown
      > | null;
      expect(callArgs).not.toBeNull();
      expect(callArgs?.cwd).toBe("/workspace");
    });

    test("disposes executor after execution", async () => {
      const fakeSandbox = createFakeSandboxModule();
      const execPlugin = createExec({
        backend: "sandbox",
        loadSandboxModule: async () => fakeSandbox.module,
      });

      await runEffect(execPlugin.execute({ command: "echo", timeout: 5000 }));

      expect(fakeSandbox.mockDispose).toHaveBeenCalled();
    });

    test("passes fs option to executor", async () => {
      let constructorOptions: unknown = null;
      const fakeSandbox = createFakeSandboxModule({
        onConstruct: (options) => {
          constructorOptions = options;
        },
      });
      const execPlugin = createExec({
        backend: "sandbox",
        fs: "overlay",
        loadSandboxModule: async () => fakeSandbox.module,
      });

      await runEffect(execPlugin.execute({ command: "echo", timeout: 5000 }));

      expect(constructorOptions).toEqual(expect.objectContaining({ fs: "overlay" }));
    });
  });

  describe("auto-discovery caching", () => {
    test("backend resolution is cached across multiple executions", async () => {
      const resolveBackend = mock(async (): Promise<ShellBackend> => "sandbox");
      const fakeSandbox = createFakeSandboxModule();
      const loadSandboxModule = mock(async () => fakeSandbox.module);
      const execPlugin = createExec({ resolveBackend, loadSandboxModule });

      await runEffect(execPlugin.execute({ command: "echo 1", timeout: 5000 }));
      await runEffect(execPlugin.execute({ command: "echo 2", timeout: 5000 }));
      await runEffect(execPlugin.execute({ command: "echo 3", timeout: 5000 }));

      expect(resolveBackend).toHaveBeenCalledTimes(1);
      expect(loadSandboxModule).toHaveBeenCalledTimes(1);
    });
  });

  describe("timeout handling", () => {
    test("sandbox backend propagates timedOut from executor", async () => {
      const fakeSandbox = createFakeSandboxModule({
        executeResult: {
          stdout: "",
          stderr: "Command timed out after 10ms",
          exitCode: -1,
          timedOut: true,
        },
      });
      const execPlugin = createExec({
        backend: "sandbox",
        loadSandboxModule: async () => fakeSandbox.module,
      });

      const exit = await runEffect(
        execPlugin.execute({ command: "sleep", args: ["100"], timeout: 10 })
      );
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;

      expect(wrappedResult.isError).toBe(false);
      const parsed = JSON.parse(wrappedResult.result);
      expect(parsed.timedOut).toBe(true);
      expect(parsed.exitCode).toBe(-1);
    });
  });

  describe("control character stripping", () => {
    test("strips control characters from command", async () => {
      const execPlugin = createExec({ backend: "local" });

      const exit = await runEffect(
        execPlugin.execute({ command: 'echo "hello"\x00\x1b', shell: true, timeout: 5000 })
      );
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;

      expect(wrappedResult.isError).toBe(false);
      const parsed = JSON.parse(wrappedResult.result);
      expect(parsed.exitCode).toBe(0);
      expect(parsed.stdout).toContain("hello");
    });
  });

  describe("error handling", () => {
    test("non-zero exit code returns proper result", async () => {
      const execPlugin = createExec({ backend: "local" });

      const exit = await runEffect(
        execPlugin.execute({
          command: "ls",
          args: ["/nonexistent/path/that/does/not/exist"],
          timeout: 5000,
        })
      );
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;

      expect(wrappedResult.isError).toBe(false);
      const parsed = JSON.parse(wrappedResult.result);
      expect(parsed.exitCode).not.toBe(0);
    });
  });
});
