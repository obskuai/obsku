import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Effect } from "effect";
import { createCodeInterpreter, type ExecutionResult, SessionManager } from "../src/index";

type PluginResult = { isError?: boolean; result: string };

type ReadUntilDelimiter = (
  session: { process: ReturnType<typeof createFakeProcess> },
  delimiter: string,
  timeoutMs: number
) => Promise<{ exitCode: number; isTimeout: boolean; stderr: string; stdout: string }>;

type FormatPayload = (language: "javascript", code: string, delimiter: string) => string;
type ExecuteSession = (session: Record<string, unknown>, code: string) => Promise<ExecutionResult>;
type DelimiterResult = Awaited<ReturnType<ReadUntilDelimiter>>;

class FakeStdin extends EventEmitter {
  writable = true;
  writes: Array<string> = [];

  constructor(private readonly writeResult: boolean) {
    super();
  }

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return this.writeResult;
  }
}

function createFakeProcess(writeResult: boolean = true) {
  const proc = new EventEmitter() as EventEmitter & {
    stderr: PassThrough;
    stdin: FakeStdin;
    stdout: PassThrough;
  };

  proc.stdin = new FakeStdin(writeResult);
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();

  return proc;
}

async function runPlugin(
  plugin: ReturnType<typeof createCodeInterpreter>,
  input: Record<string, unknown>
): Promise<ExecutionResult> {
  const output = (await Effect.runPromise(plugin.execute(input))) as PluginResult;
  expect(output.isError).toBe(false);
  return JSON.parse(output.result) as ExecutionResult;
}

function callReadUntilDelimiter(
  manager: SessionManager,
  session: { process: ReturnType<typeof createFakeProcess> },
  delimiter: string,
  timeoutMs: number
): ReturnType<ReadUntilDelimiter> {
  return Reflect.apply(
    (manager as unknown as { readUntilDelimiter: ReadUntilDelimiter }).readUntilDelimiter,
    manager,
    [session, delimiter, timeoutMs]
  ) as ReturnType<ReadUntilDelimiter>;
}

function callFormatPayload(
  manager: SessionManager,
  language: "javascript",
  code: string,
  delimiter: string
): string {
  return Reflect.apply(
    (manager as unknown as { formatPayload: FormatPayload }).formatPayload,
    manager,
    [language, code, delimiter]
  ) as string;
}

function callExecuteSession(
  manager: SessionManager,
  session: Record<string, unknown>,
  code: string
): ReturnType<ExecuteSession> {
  return Reflect.apply(
    (manager as unknown as { executeSession: ExecuteSession }).executeSession,
    manager,
    [session, code]
  ) as ReturnType<ExecuteSession>;
}

describe("local plugin stateful/stateless characterization", () => {
  test("stateful inputFiles characterization expects sessionId path to match stateless file staging", async () => {
    const sessionManager = new SessionManager();
    const plugin = createCodeInterpreter({ backend: "local", sessionManager });
    const sessionId = sessionManager.create("python");

    try {
      const stateless = await runPlugin(plugin, {
        code: `from pathlib import Path\nprint(Path("input.txt").read_text())`,
        inputFiles: { "input.txt": "hello from input" },
        language: "python",
      });

      expect(stateless.success).toBe(true);
      expect(stateless.stdout.trim()).toBe("hello from input");

      const stateful = await runPlugin(plugin, {
        code: `from pathlib import Path\nprint(Path("input.txt").read_text())`,
        inputFiles: { "input.txt": "hello from input" },
        language: "python",
        sessionId,
      });

      expect(stateful.success).toBe(true);
      expect(stateful.stdout.trim()).toBe(stateless.stdout.trim());
    } finally {
      await sessionManager.destroyAll();
    }
  });

  test("stateful timeout characterization expects sessionId path to honor requested timeout", async () => {
    const sessionManager = new SessionManager();
    const plugin = createCodeInterpreter({ backend: "local", sessionManager });
    const sessionId = sessionManager.create("python");

    try {
      const stateless = await runPlugin(plugin, {
        code: `import time\ntime.sleep(0.2)\nprint("finished")`,
        language: "python",
        timeoutMs: 10,
      });

      expect(stateless.isTimeout).toBe(true);
      expect(stateless.success).toBe(false);

      await runPlugin(plugin, {
        code: `print("ready")`,
        language: "python",
        sessionId,
      });

      const stateful = await runPlugin(plugin, {
        code: `import time\ntime.sleep(0.2)\nprint("finished")`,
        language: "python",
        sessionId,
        timeoutMs: 10,
      });

      expect(stateful.isTimeout).toBe(true);
      expect(stateful.success).toBe(false);
    } finally {
      await sessionManager.destroyAll();
    }
  });

  test("stateful language characterization expects sessionId path to honor requested language", async () => {
    const sessionManager = new SessionManager();
    const plugin = createCodeInterpreter({ backend: "local", sessionManager });
    const sessionId = sessionManager.create("python");

    try {
      const stateless = await runPlugin(plugin, {
        code: `def greet():\n    return "hello from python"\nprint(greet())`,
        language: "javascript",
      });

      expect(stateless.success).toBe(false);
      expect(stateless.stderr.length).toBeGreaterThan(0);

      const stateful = await runPlugin(plugin, {
        code: `def greet():\n    return "hello from python"\nprint(greet())`,
        language: "javascript",
        sessionId,
      });

      expect(stateful.success).toBe(false);
      expect(stateful.stderr.length).toBeGreaterThan(0);
    } finally {
      await sessionManager.destroyAll();
    }
  });

  test("stateful javascript throw characterization captures stderr while delimiter completion still resolves exitCode 0", async () => {
    const manager = new SessionManager();
    const delimiter = "__STATEFUL_JS_THROW__";
    const payload = callFormatPayload(
      manager,
      "javascript",
      String.raw`process.stdout.write("before throw\n"); throw new Error("boom");`,
      delimiter
    );

    expect(payload).toContain("catch (e) { console.error(e); }");
    expect(payload).toContain(`process.stdout.write("${delimiter}\\n")`);

    const process = createFakeProcess();
    const resultPromise = callReadUntilDelimiter(manager, { process }, delimiter, 100);

    process.stderr.emit("data", Buffer.from("Error: boom\n"));
    process.stdout.emit("data", Buffer.from(`before throw\n${delimiter}\n`));

    expect(await resultPromise).toEqual({
      exitCode: 0,
      isTimeout: false,
      stderr: "Error: boom\n",
      stdout: "before throw\n",
    });
  });

  test("stateful javascript timeout characterization preserves partial stdout and reports timeout in stderr", async () => {
    const manager = new SessionManager();
    const process = createFakeProcess();
    const resultPromise = callReadUntilDelimiter(manager, { process }, "__STATEFUL_TIMEOUT__", 10);

    process.stdout.emit("data", Buffer.from("tick\n"));

    expect(await resultPromise).toEqual({
      exitCode: 1,
      isTimeout: true,
      stderr: "Timed out after 10ms",
      stdout: "tick\n",
    });
  });

  test("stateful javascript drain characterization waits for stdin drain before reading result", async () => {
    const manager = new SessionManager();
    const process = createFakeProcess(false);
    let readCount = 0;

    Object.assign(manager as object, {
      readUntilDelimiter: async (): Promise<DelimiterResult> => {
        readCount += 1;
        return { exitCode: 0, isTimeout: false, stderr: "", stdout: "after drain\n" };
      },
    });

    const session = {
      id: "session-drain",
      language: "javascript",
      lastUsedAt: 0,
      process,
    };
    const resultPromise = callExecuteSession(
      manager,
      session,
      String.raw`process.stdout.write("after drain\n")`
    );

    await Promise.resolve();
    expect(readCount).toBe(0);

    process.stdin.emit("drain");

    expect(await resultPromise).toMatchObject({
      exitCode: 0,
      isTimeout: false,
      stderr: "",
      stdout: "after drain\n",
      success: true,
    });
    expect(readCount).toBe(1);
    expect(process.stdin.writes).toHaveLength(1);
    expect(process.stdin.writes[0]).toContain(String.raw`process.stdout.write("after drain\n")`);
    expect(process.stdin.writes[0]).toContain(
      'catch (e) { console.error(e); } finally { process.stdout.write("__OBSKU_EXEC_DONE__'
    );
    const delimiterMatch = process.stdin.writes[0].match(/__OBSKU_EXEC_DONE__\d+__/);
    expect(delimiterMatch).not.toBeNull();
    expect(process.stdin.writes[0]).toBe(
      callFormatPayload(
        manager,
        "javascript",
        String.raw`process.stdout.write("after drain\n")`,
        delimiterMatch![0]
      )
    );
  });

  test("stateful javascript stdout/stderr shaping characterization strips delimiter from stdout", async () => {
    const manager = new SessionManager();
    const delimiter = "__STATEFUL_SHAPING__";
    const process = createFakeProcess();
    const resultPromise = callReadUntilDelimiter(manager, { process }, delimiter, 100);

    process.stderr.emit("data", Buffer.from("warn\n"));
    process.stdout.emit("data", Buffer.from(`line one\nline two\n${delimiter}\nignored tail`));

    expect(await resultPromise).toEqual({
      exitCode: 0,
      isTimeout: false,
      stderr: "warn\n",
      stdout: "line one\nline two\n",
    });
  });
});
