import { describe, expect, mock, test } from "bun:test";
import { Effect, Exit } from "effect";
import { exec } from "../src/exec";

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

function mockSpawnTimeout() {
  const originalSpawn = Bun.spawn;
  const mockFn = mock((_cmd: Array<string>, opts?: { signal?: AbortSignal }) => {
    return {
      exitCode: null,
      exited: new Promise<number>((_resolve, _reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener("abort", () => {
            _reject(new Error("aborted"));
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

describe("exec tool", () => {
  test("has correct metadata", () => {
    expect(exec.name).toBe("exec");
    expect(exec.description).toBeString();
    expect(typeof exec.execute).toBe("function");
  });

  test("basic command execution (echo)", async () => {
    const { mockFn, restore } = mockSpawn("hello world\n");
    try {
      const exit = await runEffect(exec.execute({ args: ["hello", "world"], command: "echo" }));
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;
      const result = JSON.parse(wrappedResult.result) as {
        exitCode: number;
        stderr: string;
        stdout: string;
        timedOut: boolean;
      };

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello world\n");
      expect(result.stderr).toBe("");
      expect(result.timedOut).toBe(false);
      expect(mockFn).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("stdout/stderr separation", async () => {
    const { restore } = mockSpawn("out data", 0, "err data");
    try {
      const exit = await runEffect(exec.execute({ args: [], command: "myCmd" }));
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;
      const result = JSON.parse(wrappedResult.result) as {
        exitCode: number;
        stderr: string;
        stdout: string;
      };

      expect(result.stdout).toBe("out data");
      expect(result.stderr).toBe("err data");
    } finally {
      restore();
    }
  });

  test("exit code capture - success", async () => {
    const { restore } = mockSpawn("", 0);
    try {
      const exit = await runEffect(exec.execute({ command: "true" }));
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;
      const result = JSON.parse(wrappedResult.result) as { exitCode: number };
      expect(result.exitCode).toBe(0);
    } finally {
      restore();
    }
  });

  test("exit code capture - failure", async () => {
    const { restore } = mockSpawn("", 1, "command failed");
    try {
      const exit = await runEffect(exec.execute({ command: "false" }));
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;
      const result = JSON.parse(wrappedResult.result) as { exitCode: number; stderr: string };
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("command failed");
    } finally {
      restore();
    }
  });

  test("timeout enforcement", async () => {
    const { restore } = mockSpawnTimeout();
    try {
      const exit = await runEffect(exec.execute({ args: ["100"], command: "sleep", timeout: 100 }));
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;

      expect(wrappedResult.isError).toBe(true);

      const result = JSON.parse(wrappedResult.result) as { exitCode: number; timedOut: boolean };
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(-1);
    } finally {
      restore();
    }
  });

  test("cwd option", async () => {
    const { mockFn, restore } = mockSpawn("/tmp\n");
    try {
      const exit = await runEffect(exec.execute({ command: "pwd", cwd: "/tmp" }));
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;
      const result = JSON.parse(wrappedResult.result) as { exitCode: number; stdout: string };

      expect(result.exitCode).toBe(0);
      const spawnCall = mockFn.mock.calls[0];
      const spawnOpts = spawnCall[1] as { cwd?: string };
      expect(spawnOpts.cwd).toBe("/tmp");
    } finally {
      restore();
    }
  });

  test("env option", async () => {
    const { mockFn, restore } = mockSpawn("bar\n");
    try {
      const exit = await runEffect(
        exec.execute({ args: ["FOO"], command: "printenv", env: { FOO: "bar" } })
      );
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;
      const result = JSON.parse(wrappedResult.result) as { exitCode: number };

      expect(result.exitCode).toBe(0);
      const spawnCall = mockFn.mock.calls[0];
      const spawnOpts = spawnCall[1] as { env?: Record<string, string> };
      expect(spawnOpts.env).toBeDefined();
      expect(spawnOpts.env!.FOO).toBe("bar");
    } finally {
      restore();
    }
  });

  test("shell mode - passes command to /bin/sh -c", async () => {
    const { mockFn, restore } = mockSpawn("hello\n");
    try {
      const exit = await runEffect(exec.execute({ command: "echo hello | cat", shell: true }));
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;
      const result = JSON.parse(wrappedResult.result) as { exitCode: number; stdout: string };

      expect(result.exitCode).toBe(0);
      const spawnCall = mockFn.mock.calls[0];
      const spawnArgs = spawnCall[0] as Array<string>;
      expect(spawnArgs[0]).toBe("/bin/sh");
      expect(spawnArgs[1]).toBe("-c");
      expect(spawnArgs[2]).toBe("echo hello | cat");
    } finally {
      restore();
    }
  });

  test("direct mode - passes command and args separately", async () => {
    const { mockFn, restore } = mockSpawn("output");
    try {
      const exit = await runEffect(exec.execute({ args: ["-la", "/tmp"], command: "ls" }));
      const wrappedResult = extractSuccess(exit) as PluginExecutionResult;
      const result = JSON.parse(wrappedResult.result) as { exitCode: number };

      expect(result.exitCode).toBe(0);
      const spawnCall = mockFn.mock.calls[0];
      const spawnArgs = spawnCall[0] as Array<string>;
      expect(spawnArgs[0]).toBe("ls");
      expect(spawnArgs[1]).toBe("-la");
      expect(spawnArgs[2]).toBe("/tmp");
    } finally {
      restore();
    }
  });

  test("command sanitization - control chars removed", async () => {
    const { mockFn, restore } = mockSpawn("");
    try {
      const exit = await runEffect(exec.execute({ command: "echo\u0000\u0001\u007fhello" }));
      extractSuccess(exit);

      const spawnCall = mockFn.mock.calls[0];
      const spawnArgs = spawnCall[0] as Array<string>;
      expect(spawnArgs[0]).toBe("echohello");
    } finally {
      restore();
    }
  });

  test("default timeout is 30000ms", async () => {
    const { mockFn, restore } = mockSpawn("");
    try {
      await runEffect(exec.execute({ command: "test" }));

      const spawnCall = mockFn.mock.calls[0];
      const spawnOpts = spawnCall[1] as { signal?: AbortSignal };
      expect(spawnOpts.signal).toBeDefined();
    } finally {
      restore();
    }
  });

  test("shell defaults to false", async () => {
    const { mockFn, restore } = mockSpawn("");
    try {
      await runEffect(exec.execute({ args: ["arg1"], command: "mycommand" }));

      const spawnCall = mockFn.mock.calls[0];
      const spawnArgs = spawnCall[0] as Array<string>;
      expect(spawnArgs[0]).toBe("mycommand");
      expect(spawnArgs[0]).not.toBe("/bin/sh");
    } finally {
      restore();
    }
  });
});

describe("exec directive", () => {
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

  test("error-review directive handles invalid JSON", () => {
    const directive = exec.directives![0];
    const matchesBadJson = directive.match("not json at all", {});
    expect(matchesBadJson).toBe(false);
  });

  test("error-review directive injects guidance string", () => {
    const directive = exec.directives![0];
    expect(typeof directive.inject).toBe("string");
    expect((directive.inject as string).length).toBeGreaterThan(0);
  });
});
