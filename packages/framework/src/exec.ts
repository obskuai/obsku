import { DEFAULTS } from "./defaults";
import { createTaggedError } from "./errors/tagged-error";
import type { ExecOpts, ExecResult } from "./types";

export class ExecTimeoutError extends Error {
  readonly _tag = "ExecTimeoutError" as const;
  constructor(
    readonly cmd: string,
    readonly timeoutMs: number
  ) {
    super(`Command "${cmd}" timed out after ${timeoutMs}ms`);
    this.name = "ExecTimeoutError";
  }
}

export class ExecCancelledError extends createTaggedError("ExecCancelledError") {
  constructor() {
    super("Process aborted by cancellation signal");
  }
}

export async function execCmd(
  cmd: string,
  args: Array<string>,
  opts: ExecOpts = {},
  signal: AbortSignal
): Promise<ExecResult> {
  const timeout = opts.timeout ?? DEFAULTS.execTimeout;

  // Combine framework signal + per-exec timeout
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeout);

  // If parent signal already aborted, abort immediately
  if (signal.aborted) {
    clearTimeout(timeoutId);
    throw new ExecTimeoutError(cmd, 0);
  }

  const onParentAbort = () => timeoutController.abort();
  signal.addEventListener("abort", onParentAbort, { once: true });

  try {
    const proc = Bun.spawn([cmd, ...args], {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : undefined,
      signal: timeoutController.signal,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    // Bun.spawn doesn't throw on signal abort — check post-exit
    if (timeoutController.signal.aborted) {
      if (!signal.aborted) {
        throw new ExecTimeoutError(cmd, timeout);
      }
      // Parent signal caused abort (cancellation)
      throw new ExecCancelledError();
    }

    return { exitCode, stderr, stdout };
  } catch (error: unknown) {
    // Re-throw our own errors
    if (error instanceof ExecTimeoutError) {
      throw error;
    }
    if (timeoutController.signal.aborted && !signal.aborted) {
      throw new ExecTimeoutError(cmd, timeout);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", onParentAbort);
  }
}
