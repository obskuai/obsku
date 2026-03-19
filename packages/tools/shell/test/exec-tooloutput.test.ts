import { describe, expect, mock, test } from "bun:test";
import { Effect, Exit } from "effect";
import { exec } from "../src/exec";

function mockSpawnTimeout() {
  const originalSpawn = Bun.spawn;
  const mockFn = mock((_cmd: Array<string>, opts?: { signal?: AbortSignal }) => {
    return {
      exitCode: null,
      exited: new Promise<number>((_resolve, _reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener("abort", () => {
            _reject(new Error("timed out"));
          });
        }
      }),
      kill: mock(() => {}),
      killed: false,
      pid: 12_345,
      ref: mock(() => {}),
      signalCode: null,
      stderr: new Response(new Blob([])).body!,
      stdout: new Response(new Blob([])).body!,
      unref: mock(() => {}),
    } as unknown as ReturnType<typeof Bun.spawn>;
  });
  // @ts-expect-error - mock Bun.spawn
  Bun.spawn = mockFn;
  return {
    mockFn,
    restore: () => {
      Bun.spawn = originalSpawn;
    },
  };
}

function mockSpawn(stdout: string, exitCode: number = 0, stderr: string = "") {
  const originalSpawn = Bun.spawn;
  const mockFn = mock((cmd: Array<string>, opts?: Record<string, unknown>) => {
    void opts;
    const stdoutBlob = new Blob([stdout]);
    const stderrBlob = new Blob([stderr]);
    return {
      exitCode: null,
      exited: Promise.resolve(exitCode),
      kill: mock(() => {}),
      killed: false,
      pid: 12_345,
      ref: mock(() => {}),
      signalCode: null,
      stderr: new Response(stderrBlob).body!,
      stdout: new Response(stdoutBlob).body!,
      unref: mock(() => {}),
    } as unknown as ReturnType<typeof Bun.spawn>;
  });
  // @ts-expect-error - mock Bun.spawn
  Bun.spawn = mockFn;
  return {
    mockFn,
    restore: () => {
      Bun.spawn = originalSpawn;
    },
  };
}

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

describe("exec ToolOutput migration", () => {
  describe("timeout handling", () => {
    test("timeout returns result with isError:true in PluginExecutionResult", async () => {
      const { restore } = mockSpawnTimeout();
      try {
        const exit = await runEffect(
          exec.execute({ args: ["100"], command: "sleep", timeout: 100 })
        );
        const wrappedResult = extractSuccess(exit) as PluginExecutionResult;

        expect(wrappedResult.isError).toBe(true);

        const parsed = JSON.parse(wrappedResult.result);
        expect(parsed.timedOut).toBe(true);
        expect(parsed.exitCode).toBe(-1);
        expect(parsed.stderr).toContain("timed out");
      } finally {
        restore();
      }
    });
  });

  describe("non-zero exit code", () => {
    test("non-zero exit should NOT have isError in PluginExecutionResult", async () => {
      const { restore } = mockSpawn("", 1, "command failed");
      try {
        const exit = await runEffect(exec.execute({ command: "false" }));
        const wrappedResult = extractSuccess(exit) as PluginExecutionResult;

        expect(wrappedResult.isError).toBe(false);

        const parsed = JSON.parse(wrappedResult.result);
        expect(parsed.exitCode).toBe(1);
        expect(parsed.stderr).toBe("command failed");
      } finally {
        restore();
      }
    });
  });

  describe("successful execution", () => {
    test("success should NOT have isError in PluginExecutionResult", async () => {
      const { restore } = mockSpawn("hello world\n");
      try {
        const exit = await runEffect(exec.execute({ args: ["hello", "world"], command: "echo" }));
        const wrappedResult = extractSuccess(exit) as PluginExecutionResult;

        expect(wrappedResult.isError).toBe(false);

        const parsed = JSON.parse(wrappedResult.result);
        expect(parsed.exitCode).toBe(0);
        expect(parsed.stdout).toBe("hello world\n");
      } finally {
        restore();
      }
    });
  });

  describe("directive still works with non-zero exit", () => {
    test("error-review directive matches non-zero exit", () => {
      const directive = exec.directives![0];
      expect(directive.name).toBe("error-review");

      const matchesError = directive.match(
        JSON.stringify({ exitCode: 1, stderr: "fail", stdout: "", timedOut: false }),
        {}
      );
      expect(matchesError).toBe(true);
    });

    test("error-review directive does not match zero exit", () => {
      const directive = exec.directives![0];
      const matchesSuccess = directive.match(
        JSON.stringify({ exitCode: 0, stderr: "", stdout: "ok", timedOut: false }),
        {}
      );
      expect(matchesSuccess).toBe(false);
    });
  });
});
