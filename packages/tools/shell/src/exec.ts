import type { ToolOutput } from "@obsku/framework";
import { DEFAULTS, plugin } from "@obsku/framework";
import { z } from "zod";
import {
  loadSandboxExecutor,
  resolveShellBackend,
  type SandboxModule,
  type ShellBackend,
} from "./resolve-backend";

export interface CreateExecOptions {
  backend?: ShellBackend;
  resolveBackend?: (backend?: ShellBackend) => Promise<ShellBackend>;
  loadSandboxModule?: () => Promise<SandboxModule>;
  fs?: "memory" | "overlay";
  network?: {
    enabled: boolean;
    allowedUrlPrefixes?: string[];
  };
  envFilter?: {
    mode: "blocklist" | "allowlist" | "none";
    patterns?: string[];
    warn?: boolean;
  };
}

function stripControlChars(str: string): string {
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) {
      result += str[i];
    }
  }
  return result;
}

export const createExec = (opts: CreateExecOptions = {}): ReturnType<typeof plugin> => {
  let resolvedBackend: ShellBackend | null = null;
  let sandboxModule: SandboxModule | null = null;
  const loadSandboxModule = opts.loadSandboxModule ?? loadSandboxExecutor;
  const resolveBackend =
    opts.resolveBackend ??
    ((backend?: ShellBackend) => resolveShellBackend(backend, { loadSandboxModule }));

  return plugin({
    description: "Execute shell command with safety controls",
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
    name: "exec",
    params: z.object({
      args: z.array(z.string()).default([]),
      command: z.string(),
      cwd: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
      shell: z.boolean().default(false),
      timeout: z.number().default(DEFAULTS.execTimeout),
    }),
    run: async (input, ctx) => {
      const { args, command, cwd, env, shell, timeout } = input;
      const sanitizedCommand = stripControlChars(command);

      if (resolvedBackend === null) {
        resolvedBackend = await resolveBackend(opts.backend);
        if (resolvedBackend === "sandbox") {
          sandboxModule = await loadSandboxModule();
        }
      }

      if (resolvedBackend === "sandbox" && sandboxModule !== null) {
        const executor = new sandboxModule.SandboxedShellExecutor({
          envFilter: opts.envFilter,
          fs: opts.fs ?? "memory",
          network: opts.network,
        });

        try {
          const result = await executor.execute({
            args: args.length > 0 ? args : undefined,
            command: sanitizedCommand,
            cwd,
            env,
            timeout,
          });

          return {
            exitCode: result.exitCode,
            stderr: result.stderr,
            stdout: result.stdout,
            timedOut: result.timedOut,
          };
        } finally {
          await executor.dispose();
        }
      }

      const execOpts = {
        cwd,
        env,
        timeout,
      };

      try {
        if (shell) {
          const result = await ctx.exec("/bin/sh", ["-c", sanitizedCommand], execOpts);
          return {
            exitCode: result.exitCode,
            stderr: result.stderr,
            stdout: result.stdout,
            timedOut: false,
          };
        } else {
          const result = await ctx.exec(sanitizedCommand, args, execOpts);
          return {
            exitCode: result.exitCode,
            stderr: result.stderr,
            stdout: result.stdout,
            timedOut: false,
          };
        }
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          (error.name === "ExecTimeoutError" || error.message.includes("timed out"))
        ) {
          const errorOutput: ToolOutput = {
            content: JSON.stringify({
              exitCode: -1,
              stderr: error.message,
              stdout: "",
              timedOut: true,
            }),
            isError: true,
          };
          return errorOutput;
        }
        throw error;
      }
    },
  });
};

export const exec = createExec();
