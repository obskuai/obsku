// @obsku/adapter-claude-code — Claude subprocess runner
// Encapsulates all `claude -p` lifecycle: preflight, spawn, parse, return.

import { buildClaudeInvocationConfig } from "./config";
import {
  ClaudeCancelledError,
  ClaudeExecutionError,
  ClaudeMalformedOutputError,
  ClaudeNonZeroExitError,
  ClaudeNotFoundError,
  ClaudeTimeoutError,
} from "./errors";
import type { ClaudeCodeMode, ClaudeCodePluginParams } from "./types";

const PREFLIGHT_TIMEOUT_MS = 5000;
const DEFAULT_RUNNER_TIMEOUT_MS = 300_000; // 5 minutes

/** JSON envelope emitted by `claude --output-format json`. */
interface ClaudeJsonEnvelope {
  [key: string]: unknown;
  is_error?: boolean;
  result?: unknown;
}

// ── Preflight ──────────────────────────────────────────────────────────────

/**
 * Verify `claude` binary is present in PATH.
 * Throws {@link ClaudeNotFoundError} if not found.
 */
export async function runPreflight(binary?: string): Promise<void> {
  const claudeBinary = binary || process.env.CLAUDE_CODE_PATH || "claude";

  // If it's an absolute or relative path, check if file exists
  if (claudeBinary.includes("/")) {
    try {
      await Bun.file(claudeBinary).exists();
      return;
    } catch {
      // File existence check failed (not found, permission denied, etc.)
      throw new ClaudeNotFoundError();
    }
  }

  // Otherwise, check PATH using `which`
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);

  try {
    const proc = Bun.spawn(["which", claudeBinary], {
      signal: controller.signal,
      stderr: "pipe",
      stdout: "pipe",
    });

    // Drain stdout/stderr to avoid blocking
    await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

    const exitCode = await proc.exited;

    if (controller.signal.aborted) {
      // which timed out — treat as not-found rather than timeout
      throw new ClaudeNotFoundError();
    }

    if (exitCode !== 0) {
      throw new ClaudeNotFoundError();
    }
  } catch (error: unknown) {
    if (error instanceof ClaudeNotFoundError) {
      throw error;
    }
    // Unexpected spawn error (sandbox, permission denied, etc.)
    process.stderr.write(`claude-code preflight error: ${error instanceof Error ? error.message : String(error)}\n`);
    throw new ClaudeNotFoundError();
  } finally {
    clearTimeout(timerId);
  }
}

// ── Arg builder ───────────────────────────────────────────────────────────

function buildClaudeCliArgs(
  prompt: string,
  mode: ClaudeCodeMode | undefined,
  schema: Record<string, unknown> | undefined,
  extraArgs: ReadonlyArray<string> = []
): Array<string> {
  const args: Array<string> = ["-p", prompt, "--output-format", "json", "--no-session-persistence"];

  if (mode === "json" && schema !== undefined) {
    args.push("--json-schema", JSON.stringify(schema));
  }

  args.push(...extraArgs);

  return args;
}

// ── Runner ────────────────────────────────────────────────────────────────

export interface RunnerOptions {
  cliArgs?: ReadonlyArray<string>;
  /** Working directory for the subprocess. */
  cwd?: string;
  /** Abort signal from the plugin context. */
  signal?: AbortSignal;
  /** Timeout in ms (default 300 000). */
  timeoutMs?: number;
}

/**
 * Execute `claude -p <prompt>` and return parsed output.
 * text mode → string
 * json mode → Record<string, unknown>
 */
export async function runClaude(
  params: ClaudeCodePluginParams,
  opts: RunnerOptions = {}
): Promise<string | Record<string, unknown>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RUNNER_TIMEOUT_MS;
  const parentSignal = opts.signal;
  const claudeBinary = process.env.CLAUDE_CODE_PATH || "claude";

  // Preflight
  await runPreflight(claudeBinary);

  // Combined abort: timeout + parent signal
  const timeoutController = new AbortController();
  const timerId = setTimeout(() => timeoutController.abort("timeout"), timeoutMs);

  // Propagate parent cancellation into our controller
  const onParentAbort = () => timeoutController.abort("cancelled");
  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timerId);
      throw new ClaudeCancelledError();
    }
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }

  let proc: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const args = buildClaudeCliArgs(
      params.prompt,
      params.mode,
      params.schema,
      opts.cliArgs ?? buildClaudeInvocationConfig({}, { cwd: opts.cwd ?? params.cwd }).cliArgs
    );

    proc = Bun.spawn([claudeBinary, ...args], {
      cwd: opts.cwd ?? params.cwd,
      env: process.env,
      signal: timeoutController.signal,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(), // drain stderr — not surfaced publicly
    ]);

    const exitCode = await proc.exited;

    // Determine cause of abort before inspecting exit code
    if (timeoutController.signal.aborted) {
      const reason = (timeoutController.signal as AbortSignal & { reason?: unknown }).reason;
      if (reason === "timeout") {
        throw new ClaudeTimeoutError(timeoutMs);
      }
      // parent signal triggered abort
      throw new ClaudeCancelledError();
    }

    if (exitCode !== 0) {
      throw new ClaudeNonZeroExitError(exitCode);
    }

    return parseClaudeEnvelope(stdout, params.mode);
  } catch (error: unknown) {
    // Re-throw known adapter errors (they have _tag); wrap unknown as execution failure
    if (error instanceof Error && "_tag" in error) {
      throw error;
    }
    throw new ClaudeNonZeroExitError(-1);
  } finally {
    clearTimeout(timerId);
    if (parentSignal) {
      parentSignal.removeEventListener("abort", onParentAbort);
    }
  }
}

// ── Output parser ─────────────────────────────────────────────────────────

function parseClaudeEnvelope(
  raw: string,
  mode: ClaudeCodeMode | undefined
): string | Record<string, unknown> {
  let envelope: ClaudeJsonEnvelope;
  try {
    envelope = JSON.parse(raw) as ClaudeJsonEnvelope;
  } catch (parseErr) {
    process.stderr.write(`claude-code parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}\n`);
    throw new ClaudeMalformedOutputError("stdout is not valid JSON");
  }

  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    throw new ClaudeMalformedOutputError("JSON envelope is not an object");
  }

  if (envelope.is_error === true) {
    const msg =
      typeof envelope.result === "string" && envelope.result.length > 0
        ? envelope.result
        : "unknown";
    throw new ClaudeExecutionError(msg);
  }

  if (!("result" in envelope)) {
    throw new ClaudeMalformedOutputError("JSON envelope missing 'result' field");
  }

  const result = envelope.result;

  if (mode === "json") {
    if (typeof result !== "string") {
      throw new ClaudeMalformedOutputError(
        "json mode: 'result' field is not a string, cannot JSON.parse"
      );
    }
    try {
      return JSON.parse(result) as Record<string, unknown>;
    } catch (parseErr) {
      process.stderr.write(`claude-code parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}\n`);
      throw new ClaudeMalformedOutputError("json mode: 'result' field is not valid JSON");
    }
  }

  // text mode — result must be a string (or coerce gracefully)
  if (typeof result !== "string") {
    throw new ClaudeMalformedOutputError("text mode: 'result' field is not a string");
  }
  return result.trim();
}
