import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { DEFAULTS } from "@obsku/framework";
import {
  attachCompletionMetadata,
  type CompletionMode,
  type ReadUntilDelimiterResult,
} from "./session-completion";

export function readUntilDelimiter(
  proc: ChildProcessWithoutNullStreams | undefined,
  delimiter: string,
  timeoutMs: number = DEFAULTS.codeInterpreterSessionTimeout
): Promise<ReadUntilDelimiterResult> {
  if (!proc) {
    return Promise.resolve(
      attachCompletionMetadata(
        {
          exitCode: 1,
          isTimeout: false,
          stderr: "Process not available",
          stdout: "",
        },
        "unavailable"
      )
    );
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let resolved = false;

    const cleanup = (): void => {
      clearTimeout(timeout);
      proc.stdout.off("data", onStdout);
      proc.stderr.off("data", onStderr);
      proc.off("exit", onExit);
    };

    const finish = (
      output: string,
      err: string,
      exitCode: number,
      isTimeout: boolean,
      completion: CompletionMode
    ): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      resolve(
        attachCompletionMetadata(
          {
            exitCode,
            isTimeout,
            stderr: err,
            stdout: output,
          },
          completion
        )
      );
    };

    const timeout = setTimeout(() => {
      finish(stdout, stderr.length ? stderr : `Timed out after ${timeoutMs}ms`, 1, true, "timeout");
    }, timeoutMs);

    const onStdout = (chunk: Buffer): void => {
      stdout += chunk.toString();
      const index = stdout.indexOf(delimiter);
      if (index !== -1) {
        finish(stdout.slice(0, index), stderr, 0, false, "delimiter");
      }
    };

    const onStderr = (chunk: Buffer): void => {
      stderr += chunk.toString();
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      const message = signal ? `Process exited with signal ${signal}` : "Process exited";
      finish(stdout, stderr.length ? stderr : message, code ?? 1, false, "exit");
    };

    proc.stdout.on("data", onStdout);
    proc.stderr.on("data", onStderr);
    proc.on("exit", onExit);
  });
}
