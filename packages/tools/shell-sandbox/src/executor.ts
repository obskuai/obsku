import { DEFAULTS, filterEnvVars, getErrorMessage } from "@obsku/framework";
import { Bash, type IFileSystem, InMemoryFs, type NetworkConfig, OverlayFs } from "just-bash";
import type {
  SandboxedShellExecutor as SandboxedShellExecutorContract,
  SandboxedShellOptions,
  ShellExecutionOptions,
  ShellExecutionResult,
} from "./types";

const DEFAULT_TIMEOUT_MS = DEFAULTS.toolTimeout;
const TIMEOUT_EXIT_CODE = -1;


function normalizeExecutionError(error: unknown): ShellExecutionResult {
  return {
    exitCode: 1,
    stderr: getErrorMessage(error),
    stdout: "",
    timedOut: false,
  };
}

/**
 * Shell-escapes a single argument to prevent injection
 * Wraps in single quotes, escaping any single quotes within
 */
function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}
export class SandboxedShellExecutor implements SandboxedShellExecutorContract {
  private readonly options: SandboxedShellOptions;
  private disposed = false;

  constructor(options: SandboxedShellOptions) {
    this.options = options;
  }

  async execute(opts: ShellExecutionOptions): Promise<ShellExecutionResult> {
    if (this.disposed) {
      return normalizeExecutionError(new Error("SandboxedShellExecutor has been disposed"));
    }

    const timeoutMs = opts.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;

    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : undefined;

    try {
      const { cwd, fs } = this.createFileSystem();
      const rawEnv = filterEnvVars(opts.env, this.options.envFilter, "shell-sandbox");
      const filteredEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawEnv)) {
        if (v !== undefined) filteredEnv[k] = v;
      }
      const bash = new Bash({
        cwd,
        fs,
        network: this.createNetworkConfig(),
      });

      // Build command with args and cwd support
      let command = opts.command;
      if (opts.args && opts.args.length > 0) {
        command = command + " " + opts.args.map(shellEscape).join(" ");
      }
      if (opts.cwd) {
        command = `cd ${shellEscape(opts.cwd)} && ` + command;
      }

      const result = await bash.exec(command, {
        env: filteredEnv,
        signal: controller.signal,
      });

      return {
        exitCode: timedOut && result.exitCode === 0 ? TIMEOUT_EXIT_CODE : result.exitCode,
        stderr: timedOut ? this.buildTimeoutMessage(timeoutMs) : result.stderr,
        stdout: result.stdout,
        timedOut,
      };
    } catch (error: unknown) {
      if (timedOut || this.isAbortError(error)) {
        return {
          exitCode: TIMEOUT_EXIT_CODE,
          stderr: this.buildTimeoutMessage(timeoutMs),
          stdout: "",
          timedOut: true,
        };
      }

      return normalizeExecutionError(error);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  private buildTimeoutMessage(timeoutMs: number): string {
    return `Command timed out after ${timeoutMs}ms`;
  }

  private createFileSystem(): { cwd?: string; fs: IFileSystem } {
    if (this.options.fs === "overlay") {
      const fs = new OverlayFs({ root: process.cwd() });
      return {
        cwd: fs.getMountPoint(),
        fs,
      };
    }

    return {
      fs: new InMemoryFs(),
    };
  }

  private createNetworkConfig(): NetworkConfig | undefined {
    if (!this.options.network?.enabled) {
      return undefined;
    }

    return {
      allowedUrlPrefixes: this.options.network.allowedUrlPrefixes ?? [],
    };
  }

  private isAbortError(error: unknown): boolean {
    return (
      error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))
    );
  }
}
