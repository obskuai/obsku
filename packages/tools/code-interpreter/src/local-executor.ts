import { spawn } from "node:child_process";
import { assertNever, DEFAULTS } from "@obsku/framework";
import { MAX_INPUT_FILE_BYTES, MAX_TOTAL_OUTPUT_BYTES } from "./constants";
import { SessionManager } from "./session-manager";
import { type EnvFilterOptions, filterEnvVars } from "@obsku/framework";
import { killProcessTree } from "./session-process";
import type {
  CodeExecutor,
  ExecutionOptions,
  ExecutionResult,
  SessionOptions,
  SupportedLanguage,
} from "./types";
import { createWorkspace } from "./workspace";

interface ProcessResult {
  exitCode: number;
  isTimeout: boolean;
  stderr: string;
  stdout: string;
}

function runProcess(
  cmd: string,
  args: Array<string>,
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let resolved = false;
    let timedOut = false;

    const finish = (exitCode: number, isTimeout: boolean): void => {
      if (resolved) {
        return;
      }

      resolved = true;
      clearTimeout(timer);
      resolve({ exitCode, isTimeout, stderr, stdout });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      if (!stderr) {
        stderr = `Timed out after ${timeoutMs}ms`;
      }
      killProcessTree(child, "SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      finish(code ?? 1, timedOut);
    });

    child.on("error", (err) => {
      stderr += err.message;
      finish(1, false);
    });
  });
}

function commandForLanguage(language: SupportedLanguage): { args: Array<string>; cmd: string } {
  switch (language) {
    case "python":
      return { args: [], cmd: "python3" };
    case "javascript":
      return { args: [], cmd: "node" };
    case "typescript":
      return { args: ["run"], cmd: "bun" };
    default:
      assertNever(language);
  }
}

function contentByteLength(content: string | Uint8Array): number {
  return typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength;
}

export class LocalProcessExecutor implements CodeExecutor {
  readonly name = "local-process";
  readonly supportedLanguages: Array<SupportedLanguage> = ["python", "javascript", "typescript"];
  readonly sessionManager: SessionManager;
  private readonly envFilter?: EnvFilterOptions;

  constructor(options: { envFilter?: EnvFilterOptions } = {}) {
    this.envFilter = options.envFilter;
    this.sessionManager = new SessionManager({ envFilter: options.envFilter });
  }

  async initialize(): Promise<void> {}

  async execute(options: ExecutionOptions): Promise<ExecutionResult> {
    if (options.sessionId) {
      return this.sessionManager.execute({ ...options, sessionId: options.sessionId });
    }

    const { code, inputFiles, language, timeoutMs = DEFAULTS.codeInterpreterExecTimeout } = options;
    const workspace = await createWorkspace();

    try {
      const inputFileNames: Array<string> = [];

      if (inputFiles) {
        for (const [name, content] of inputFiles) {
          const size = contentByteLength(content);
          if (size > MAX_INPUT_FILE_BYTES) {
            throw new Error(`Input file "${name}" exceeds 10MB limit (${size} bytes)`);
          }
          await workspace.stageFile(name, content);
          inputFileNames.push(name);
        }
      }

      const ext = language === "python" ? "py" : language === "typescript" ? "ts" : "js";
      const codeFile = `__code__.${ext}`;
      await workspace.stageFile(codeFile, code);
      inputFileNames.push(codeFile);

      const { args, cmd } = commandForLanguage(language);
      const filteredEnv = filterEnvVars(process.env, this.envFilter, "code-interpreter");
      const startTime = Date.now();
      const proc = await runProcess(
        cmd,
        [...args, codeFile],
        workspace.dir,
        timeoutMs,
        filteredEnv
      );
      const executionTimeMs = Date.now() - startTime;

      const rawOutputFiles = await workspace.collectOutputFiles(inputFileNames);

      let totalOutputBytes = 0;
      const outputFiles = new Map<string, Uint8Array>();
      for (const [name, content] of rawOutputFiles) {
        totalOutputBytes += content.byteLength;
        if (totalOutputBytes > MAX_TOTAL_OUTPUT_BYTES) {
          throw new Error(`Total output size exceeds 50MB limit`);
        }
        outputFiles.set(name, content);
      }

      return {
        executionTimeMs,
        exitCode: proc.exitCode,
        isTimeout: proc.isTimeout,
        outputFiles: outputFiles.size > 0 ? outputFiles : undefined,
        stderr: proc.stderr,
        stdout: proc.stdout,
        success: proc.exitCode === 0 && !proc.isTimeout,
      };
    } finally {
      await workspace.cleanup();
    }
  }

  async createSession(_id: string, opts: SessionOptions): Promise<void> {
    this.sessionManager.create(opts.language, opts);
  }

  async destroySession(id: string): Promise<void> {
    await this.sessionManager.destroy(id);
  }

  async dispose(): Promise<void> {
    await this.sessionManager.destroyAll();
  }
}
