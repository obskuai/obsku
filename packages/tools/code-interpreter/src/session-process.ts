import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { DEFAULTS, type EnvFilterOptions, filterEnvVars, isErrnoException } from "@obsku/framework";
import type { SessionLanguage } from "./session-payload";

const PROCESS_KILL_GRACE_MS = DEFAULTS.processKillGraceTimeout;

export function commandForLanguage(language: SessionLanguage): {
  args: Array<string>;
  cmd: string;
} {
  if (language === "python") {
    return { args: ["-i", "-u"], cmd: "python3" };
  }

  return { args: [], cmd: "bun" };
}

export function spawnSessionProcess(
  language: SessionLanguage,
  cwd: string,
  onExit: () => void,
  envFilter?: EnvFilterOptions
): ChildProcessWithoutNullStreams {
  const { args, cmd } = commandForLanguage(language);
  const filteredEnv = filterEnvVars(process.env, envFilter, "code-interpreter");
  const child = spawn(cmd, args, {
    cwd,
    detached: process.platform !== "win32",
    env: filteredEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.on("exit", onExit);
  return child;
}

export function killProcessTree(
  proc: Pick<ChildProcessWithoutNullStreams, "kill" | "pid">,
  signal: NodeJS.Signals
): void {
  if (proc.pid == null) {
    return;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-proc.pid, signal);
      return;
    } catch (error: unknown) {
      if (isErrnoException(error) && error.code !== "ESRCH") {
        if (process.env.OBSKU_DEBUG)
          process.stderr.write(`[obsku:code-interpreter] kill failed (code=${error.code}): ${error}\n`);
      }
    }
  }

  try {
    proc.kill(signal);
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code !== "ESRCH") {
      if (process.env.OBSKU_DEBUG)
        process.stderr.write(`[obsku:code-interpreter] kill failed (code=${error.code}): ${error}\n`);
    }
  }
}

export async function terminateProcess(proc: ChildProcessWithoutNullStreams): Promise<void> {
  await new Promise<void>((resolve) => {
    let finished = false;
    const finalize = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      resolve();
    };

    const timer = setTimeout(() => {
      killProcessTree(proc, "SIGKILL");
      finalize();
    }, PROCESS_KILL_GRACE_MS);

    proc.once("exit", () => {
      clearTimeout(timer);
      finalize();
    });

    killProcessTree(proc, "SIGTERM");
  });
}
