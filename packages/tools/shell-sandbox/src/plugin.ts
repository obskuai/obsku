import { DEFAULTS, plugin } from "@obsku/framework";
import { z } from "zod";
import { SandboxedShellExecutor } from "./executor";
import type {
  SandboxedShellOptions,
  ShellExecutionOptions,
  ShellExecutionResult,
} from "./types";

/**
 * Default options for sandboxed shell execution
 * Uses in-memory filesystem for full isolation
 */
const DEFAULT_SANDBOX_OPTIONS: SandboxedShellOptions = {
  fs: "memory",
  timeoutMs: DEFAULTS.execTimeout,
};

/**
 * Creates a sandboxed exec plugin with custom options
 *
 * The sandboxed exec plugin provides isolated shell command execution using
 * just-bash with configurable filesystem strategies (memory or overlay) and
 * optional network restrictions. All commands run in a sandboxed environment
 * with timeout protection.
 *
 * Available commands: Standard shell utilities (echo, cat, ls, pwd, grep, etc.)
 * Restrictions:
 * - Filesystem is isolated (memory-based by default)
 * - Network is disabled by default
 * - Commands have configurable timeout limits
 * - No direct access to host shell
 *
 * @param opts - Optional configuration for the sandboxed environment
 * @returns Plugin configured for sandboxed shell execution
 */
export const createSandboxedExec = (opts?: SandboxedShellOptions) =>
  plugin({
    description: opts?.network?.enabled
      ? "Execute shell commands in a sandboxed environment with restricted network access. Uses just-bash for isolation with configurable filesystem (memory or overlay). Available commands: Standard shell utilities (echo, cat, ls, pwd, grep, curl with allowed URLs, etc.). Restrictions: Filesystem isolated, network restricted to allowed URLs only, timeout protected, no direct host access."
      : "Execute shell commands in a sandboxed environment. Uses just-bash for full isolation with configurable filesystem (memory or overlay). Available commands: Standard shell utilities (echo, cat, ls, pwd, grep, etc.). Restrictions: Filesystem isolated, network disabled, timeout protected, no direct host access.",
    directives: [
      {
        inject:
          "The command exited with a non-zero status. Read the error message carefully before deciding on the next action. The error output may contain important diagnostic information.",
        match: (result: string, _input: Record<string, unknown>): boolean => {
          try {
            const parsed = JSON.parse(result);
            return parsed.exitCode !== 0;
          } catch {
            return false;
          }
        },
        name: "error-review",
      },
    ],
    name: "sandboxed_exec",
    params: z.object({
      command: z.string(),
      env: z.record(z.string(), z.string()).optional(),
      timeoutMs: z.number().optional(),
    }),
    run: async (input, _ctx) => {
      const { command, env, timeoutMs } = input;

      const executor = new SandboxedShellExecutor({
        ...DEFAULT_SANDBOX_OPTIONS,
        ...opts,
      });

      try {
        const execOpts: ShellExecutionOptions = {
          command,
          env,
          timeoutMs,
        };

        const result: ShellExecutionResult = await executor.execute(execOpts);

        return {
          exitCode: result.exitCode,
          stderr: result.stderr,
          stdout: result.stdout,
          timedOut: result.timedOut,
        };
      } finally {
        await executor.dispose();
      }
    },
  });

/**
 * Default sandboxed exec plugin
 *
 * Ready-to-use plugin with default configuration (in-memory filesystem,
 * network disabled, standard timeout). Import and use directly with agents.
 *
 * @example
 * ```typescript
 * import { agent } from "@obsku/framework";
 * import { sandboxedExec } from "@obsku/tool-shell-sandbox";
 *
 * const myAgent = agent({
 *   name: "sandboxed",
 *   prompt: "You can run shell commands in an isolated environment",
 *   tools: [sandboxedExec],
 * });
 * ```
 */
export const sandboxedExec = createSandboxedExec();

export default sandboxedExec;
