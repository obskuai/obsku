/**
 * Integration tests for runner.ts — all subprocess calls mocked via Bun.spawn.
 * No real `claude` binary, auth, or network required.
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  ClaudeCancelledError,
  ClaudeExecutionError,
  ClaudeMalformedOutputError,
  ClaudeNonZeroExitError,
  ClaudeNotFoundError,
  ClaudeTimeoutError,
} from "../src/errors";
import { runClaude, runPreflight } from "../src/runner";

// ── Helpers ───────────────────────────────────────────────────────────────────

const originalSpawn = Bun.spawn;

afterEach(() => {
  Bun.spawn = originalSpawn;
});

/** Build a minimal fake Bun.spawn return value. */
function makeProc(
  stdout: string,
  exitCode: number,
  stderr = "",
  exitDelayMs = 0
): ReturnType<typeof Bun.spawn> {
  return {
    exitCode: null,
    exited:
      exitDelayMs > 0
        ? new Promise<number>((resolve) => setTimeout(() => resolve(exitCode), exitDelayMs))
        : Promise.resolve(exitCode),
    kill: mock(() => {}),
    killed: false,
    pid: 12_345,
    ref: mock(() => {}),
    signalCode: null,
    stderr: new Response(new Blob([stderr])).body!,
    stdout: new Response(new Blob([stdout])).body!,
    unref: mock(() => {}),
  } as unknown as ReturnType<typeof Bun.spawn>;
}

/**
 * Replace Bun.spawn with a mock that:
 * - returns whichProc for `which claude`
 * - returns claudeProc for all other calls
 */
function mockSpawn(whichExitCode: number, claudeProc: ReturnType<typeof Bun.spawn>) {
  const spawnFn = mock((cmd: Array<string>) => {
    if (cmd[0] === "which") {
      return makeProc("/usr/bin/claude", whichExitCode);
    }
    return claudeProc;
  });
  // @ts-expect-error - replacing global for test
  Bun.spawn = spawnFn;
  return spawnFn;
}

/** Build a JSON envelope as the claude CLI would emit. */
function makeEnvelope(result: unknown, is_error = false): string {
  return JSON.stringify({ is_error, result });
}

// ── runPreflight() ────────────────────────────────────────────────────────────

describe("runPreflight()", () => {
  test("resolves when `which claude` exits 0", async () => {
    // @ts-expect-error - replacing global for test
    Bun.spawn = mock(() => makeProc("/usr/bin/claude", 0));
    await expect(runPreflight()).resolves.toBeUndefined();
  });

  test("throws ClaudeNotFoundError when `which claude` exits non-zero", async () => {
    // @ts-expect-error - replacing global for test
    Bun.spawn = mock(() => makeProc("", 1));
    await expect(runPreflight()).rejects.toBeInstanceOf(ClaudeNotFoundError);
  });

  test("throws ClaudeNotFoundError when spawn itself throws (binary missing)", async () => {
    // @ts-expect-error - replacing global for test
    Bun.spawn = mock(() => {
      throw new Error("spawn ENOENT");
    });
    await expect(runPreflight()).rejects.toBeInstanceOf(ClaudeNotFoundError);
  });

  test("ClaudeNotFoundError has correct _tag", async () => {
    // @ts-expect-error - replacing global for test
    Bun.spawn = mock(() => makeProc("", 127));
    const err = await runPreflight().catch((error) => error);
    expect(err._tag).toBe("ClaudeNotFoundError");
    expect(err.name).toBe("ClaudeNotFoundError");
  });
});

// ── Invocation arguments ──────────────────────────────────────────────────────

describe("runClaude() — invocation arguments", () => {
  test("passes prompt via -p flag and uses JSON output format", async () => {
    const spawnFn = mockSpawn(0, makeProc(makeEnvelope("hi"), 0));
    await runClaude({ prompt: "say hi" });

    // First call: preflight `which`; second call: actual claude
    expect(spawnFn.mock.calls.length).toBe(2);
    const claudeArgs = (spawnFn.mock.calls[1] as unknown as [string[]])[0];

    expect(claudeArgs[0]).toBe("claude");
    expect(claudeArgs).toContain("-p");
    expect(claudeArgs).toContain("say hi");
    expect(claudeArgs).toContain("--output-format");
    expect(claudeArgs).toContain("json");
    expect(claudeArgs).toContain("--no-session-persistence");
  });

  test("includes --json-schema when mode=json and schema provided", async () => {
    const schema = { properties: { name: { type: "string" } }, type: "object" };
    const inner = { name: "Alice" };
    const spawnFn = mockSpawn(0, makeProc(makeEnvelope(JSON.stringify(inner)), 0));

    await runClaude({ mode: "json", prompt: "get name", schema });

    const claudeArgs = (spawnFn.mock.calls[1] as unknown as [string[]])[0];
    expect(claudeArgs).toContain("--json-schema");
    const idx = claudeArgs.indexOf("--json-schema");
    expect(claudeArgs[idx + 1]).toBe(JSON.stringify(schema));
  });

  test("does not include --json-schema when mode=text", async () => {
    const spawnFn = mockSpawn(0, makeProc(makeEnvelope("result"), 0));
    await runClaude({ mode: "text", prompt: "hello" });

    const claudeArgs = (spawnFn.mock.calls[1] as unknown as [string[]])[0];
    expect(claudeArgs).not.toContain("--json-schema");
  });

  test("does not include --json-schema when mode=json but no schema", async () => {
    const spawnFn = mockSpawn(0, makeProc(makeEnvelope(JSON.stringify({ ok: true })), 0));
    await runClaude({ mode: "json", prompt: "hello" });

    const claudeArgs = (spawnFn.mock.calls[1] as unknown as [string[]])[0];
    expect(claudeArgs).not.toContain("--json-schema");
  });
});

// ── Success paths ─────────────────────────────────────────────────────────────

describe("runClaude() — success paths", () => {
  test("text mode (default) returns trimmed string from envelope result", async () => {
    mockSpawn(0, makeProc(makeEnvelope("  hello world  "), 0));
    const result = await runClaude({ prompt: "greet" });
    expect(result).toBe("hello world");
  });

  test("text mode (explicit) returns trimmed string", async () => {
    mockSpawn(0, makeProc(makeEnvelope("answer\n"), 0));
    const result = await runClaude({ mode: "text", prompt: "greet" });
    expect(result).toBe("answer");
  });

  test("json mode returns parsed object from double-encoded result", async () => {
    const inner = { count: 42, nested: { ok: true }, status: "done" };
    mockSpawn(0, makeProc(makeEnvelope(JSON.stringify(inner)), 0));

    const result = await runClaude({ mode: "json", prompt: "get status" });
    expect(result).toEqual(inner);
  });

  test("json mode result is Record<string, unknown> shape", async () => {
    const inner = { key: "value" };
    mockSpawn(0, makeProc(makeEnvelope(JSON.stringify(inner)), 0));

    const result = await runClaude({ mode: "json", prompt: "q" });
    expect(typeof result).toBe("object");
    expect((result as Record<string, unknown>).key).toBe("value");
  });
});

// ── Error paths ───────────────────────────────────────────────────────────────

describe("runClaude() — ClaudeNotFoundError", () => {
  test("throws when `which claude` fails (exit 1)", async () => {
    mockSpawn(1, makeProc("", 0));
    await expect(runClaude({ prompt: "hello" })).rejects.toBeInstanceOf(ClaudeNotFoundError);
  });

  test("ClaudeNotFoundError has correct _tag", async () => {
    mockSpawn(1, makeProc("", 0));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err._tag).toBe("ClaudeNotFoundError");
  });
});

describe("runClaude() — ClaudeNonZeroExitError", () => {
  test("throws when claude exits with code 1", async () => {
    mockSpawn(0, makeProc("", 1));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeNonZeroExitError);
    expect((err as ClaudeNonZeroExitError).exitCode).toBe(1);
  });

  test("throws when claude exits with code 2", async () => {
    mockSpawn(0, makeProc("", 2));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeNonZeroExitError);
    expect((err as ClaudeNonZeroExitError).exitCode).toBe(2);
  });

  test("ClaudeNonZeroExitError has correct _tag and message", async () => {
    mockSpawn(0, makeProc("", 3));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err._tag).toBe("ClaudeNonZeroExitError");
    expect(err.message).toContain("3");
  });
});

describe("runClaude() — ClaudeExecutionError (is_error in envelope)", () => {
  test("throws ClaudeExecutionError when is_error:true with string result", async () => {
    mockSpawn(0, makeProc(makeEnvelope("Something went wrong", true), 0));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeExecutionError);
    expect(err.message).toContain("Something went wrong");
  });

  test("throws ClaudeExecutionError with 'unknown' when is_error:true and no result", async () => {
    mockSpawn(0, makeProc(JSON.stringify({ is_error: true }), 0));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeExecutionError);
    expect(err.message).toContain("unknown");
  });

  test("throws ClaudeExecutionError with 'unknown' when result is empty string", async () => {
    mockSpawn(0, makeProc(makeEnvelope("", true), 0));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeExecutionError);
    expect(err.message).toContain("unknown");
  });

  test("ClaudeExecutionError has correct _tag", async () => {
    mockSpawn(0, makeProc(makeEnvelope("boom", true), 0));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err._tag).toBe("ClaudeExecutionError");
  });
});

describe("runClaude() — ClaudeMalformedOutputError (invalid JSON)", () => {
  test("throws when stdout is not valid JSON", async () => {
    mockSpawn(0, makeProc("not valid json at all", 0));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeMalformedOutputError);
    expect(err.message).toContain("not valid JSON");
  });

  test("throws when stdout is an empty string", async () => {
    mockSpawn(0, makeProc("", 0));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeMalformedOutputError);
  });

  test("throws when JSON envelope is an array (not an object)", async () => {
    mockSpawn(0, makeProc(JSON.stringify([1, 2, 3]), 0));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeMalformedOutputError);
    expect(err.message).toContain("not an object");
  });

  test("throws when JSON envelope is null", async () => {
    mockSpawn(0, makeProc("null", 0));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeMalformedOutputError);
    expect(err.message).toContain("not an object");
  });

  test("throws when JSON envelope has no 'result' field", async () => {
    mockSpawn(0, makeProc(JSON.stringify({ is_error: false, other: "stuff" }), 0));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeMalformedOutputError);
    expect(err.message).toContain("missing 'result'");
  });

  test("throws in text mode when result field is not a string", async () => {
    mockSpawn(0, makeProc(JSON.stringify({ is_error: false, result: 42 }), 0));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeMalformedOutputError);
    expect(err.message).toContain("not a string");
  });

  test("throws in text mode when result field is an object", async () => {
    mockSpawn(0, makeProc(JSON.stringify({ is_error: false, result: { nested: true } }), 0));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeMalformedOutputError);
    expect(err.message).toContain("not a string");
  });

  test("throws in json mode when result string is invalid JSON", async () => {
    mockSpawn(0, makeProc(makeEnvelope("not-parseable-json"), 0));
    const err = await runClaude({ mode: "json", prompt: "hello" }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeMalformedOutputError);
    expect(err.message).toContain("not valid JSON");
  });

  test("throws in json mode when result field is a number (not a string)", async () => {
    mockSpawn(0, makeProc(JSON.stringify({ is_error: false, result: 99 }), 0));
    const err = await runClaude({ mode: "json", prompt: "hello" }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeMalformedOutputError);
    expect(err.message).toContain("not a string");
  });

  test("ClaudeMalformedOutputError has correct _tag", async () => {
    mockSpawn(0, makeProc("garbage", 0));
    const err = await runClaude({ prompt: "hello" }).catch((error) => error);
    expect(err._tag).toBe("ClaudeMalformedOutputError");
  });
});

describe("runClaude() — ClaudeTimeoutError", () => {
  // proc.exited is delayed 200ms; timeoutMs is 10ms → timeout fires during await
  test("throws ClaudeTimeoutError when execution exceeds timeout", async () => {
    mockSpawn(0, makeProc(makeEnvelope("hello"), 0, "", 200));

    const err = await runClaude({ prompt: "hello" }, { timeoutMs: 10 }).catch((error) => error);
    expect(err).toBeInstanceOf(ClaudeTimeoutError);
    expect((err as ClaudeTimeoutError).timeoutMs).toBe(10);
  }, 5000);

  test("ClaudeTimeoutError has correct _tag and message", async () => {
    mockSpawn(0, makeProc(makeEnvelope("hello"), 0, "", 200));

    const err = await runClaude({ prompt: "hello" }, { timeoutMs: 10 }).catch((error) => error);
    expect(err._tag).toBe("ClaudeTimeoutError");
    expect(err.message).toContain("10");
  }, 5000);
});

describe("runClaude() — ClaudeCancelledError", () => {
  test("throws ClaudeCancelledError immediately when parent signal is pre-aborted", async () => {
    // which must succeed — preflight runs before the signal check
    // @ts-expect-error - replacing global for test
    Bun.spawn = mock((cmd: Array<string>) => {
      if (cmd[0] === "which") {
        return makeProc("/usr/bin/claude", 0);
      }
      // claude should never be spawned for a pre-aborted signal
      return makeProc(makeEnvelope("hello"), 0);
    });

    const controller = new AbortController();
    controller.abort();

    const err = await runClaude({ prompt: "hello" }, { signal: controller.signal }).catch(
      (error) => error
    );
    expect(err).toBeInstanceOf(ClaudeCancelledError);
  });

  test("ClaudeCancelledError has correct _tag and message", async () => {
    // @ts-expect-error - replacing global for test
    Bun.spawn = mock((cmd: Array<string>) => {
      if (cmd[0] === "which") {
        return makeProc("/usr/bin/claude", 0);
      }
      return makeProc(makeEnvelope("hello"), 0);
    });

    const controller = new AbortController();
    controller.abort();

    const err = await runClaude({ prompt: "hello" }, { signal: controller.signal }).catch(
      (error) => error
    );
    expect(err._tag).toBe("ClaudeCancelledError");
    expect(err.message).toContain("cancelled");
  });
});

// ── Error taxonomy sanity checks ──────────────────────────────────────────────

describe("error class properties", () => {
  test("ClaudeNotFoundError has expected message snippet", () => {
    const err = new ClaudeNotFoundError();
    expect(err.message).toContain("claude binary not found");
    expect(err._tag).toBe("ClaudeNotFoundError");
    expect(err instanceof Error).toBe(true);
  });

  test("ClaudeTimeoutError carries timeoutMs", () => {
    const err = new ClaudeTimeoutError(12_000);
    expect(err.timeoutMs).toBe(12_000);
    expect(err.message).toContain("12000");
    expect(err._tag).toBe("ClaudeTimeoutError");
  });

  test("ClaudeNonZeroExitError carries exitCode", () => {
    const err = new ClaudeNonZeroExitError(42);
    expect(err.exitCode).toBe(42);
    expect(err.message).toContain("42");
    expect(err._tag).toBe("ClaudeNonZeroExitError");
  });

  test("ClaudeExecutionError carries message from Claude", () => {
    const err = new ClaudeExecutionError("rate limit exceeded");
    expect(err.message).toContain("rate limit exceeded");
    expect(err._tag).toBe("ClaudeExecutionError");
  });

  test("ClaudeMalformedOutputError carries description", () => {
    const err = new ClaudeMalformedOutputError("stdout is not valid JSON");
    expect(err.message).toContain("stdout is not valid JSON");
    expect(err._tag).toBe("ClaudeMalformedOutputError");
  });

  test("ClaudeCancelledError has expected message", () => {
    const err = new ClaudeCancelledError();
    expect(err.message).toContain("cancelled");
    expect(err._tag).toBe("ClaudeCancelledError");
  });
});
