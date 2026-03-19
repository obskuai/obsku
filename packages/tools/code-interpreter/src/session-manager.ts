import { DEFAULTS } from "@obsku/framework";
import type { BaseSessionRecord } from "./base-session-manager";
import { BaseSessionManager } from "./base-session-manager";
import { createErrorResult } from "./constants";
import {
  type CompletionMode,
  type ReadUntilDelimiterResult,
  readCompletion,
} from "./session-completion";
import {
  extractUserCodeOutcome,
  formatExecutionPayload,
  formatInitializationPayload,
  type SessionLanguage,
  type UserCodeOutcome,
} from "./session-payload";
import type { EnvFilterOptions } from "@obsku/framework";
import { spawnSessionProcess, terminateProcess } from "./session-process";
import { readUntilDelimiter as readProcessUntilDelimiter } from "./session-stream-reader";
import type { ExecutionResult } from "./types";
import { createWorkspace, type WorkspaceContext } from "./workspace";

const PYTHON_INIT_TIMEOUT_MS = DEFAULTS.codeInterpreterPythonInitTimeout;
const JS_INIT_TIMEOUT_MS = DEFAULTS.codeInterpreterJsInitTimeout;
interface SessionRecord extends BaseSessionRecord<SessionLanguage> {
  process?: ReturnType<typeof spawnSessionProcess>;
  workspace?: WorkspaceContext;
  workspaceCleanup?: () => Promise<void>;
  workspaceDir?: string;
}

interface SessionManagerOptions {
  envFilter?: EnvFilterOptions;
}

export class SessionManager extends BaseSessionManager<SessionRecord, SessionLanguage> {
  constructor(private readonly options: SessionManagerOptions = {}) {
    super();
  }

  protected extendSessionRecord(baseRecord: BaseSessionRecord<SessionLanguage>): SessionRecord {
    return { ...baseRecord };
  }

  protected async executeSession(session: SessionRecord, code: string): Promise<ExecutionResult> {
    const options = session.pendingExecutionOptions;
    const language = options?.language ?? session.language;
    const timeoutMs = options?.timeoutMs ?? DEFAULTS.codeInterpreterSessionTimeout;

    if (language !== session.language) {
      return createErrorResult(
        `Session ${session.id} was created for ${session.language}; requested ${language}`
      );
    }

    if (options?.inputFiles?.size) {
      if (!session.workspace) {
        return createErrorResult(`Session ${session.id} workspace is not available`);
      }

      for (const [name, content] of options.inputFiles) {
        await session.workspace.stageFile(name, content);
      }
    }

    const delimiter = `__OBSKU_EXEC_DONE__${Date.now()}__`;
    const startTime = Date.now();
    const payload = this.formatPayload(session.language, code, delimiter);
    const proc = this.getProcess(session);
    if (!proc) {
      return createErrorResult(`Session ${session.id} process is not available`);
    }

    if (!proc.stdin.writable) {
      return createErrorResult(`Session ${session.id} stdin is not writable`);
    }

    const flushed = proc.stdin.write(payload);
    if (!flushed) {
      await new Promise<void>((resolve) => proc.stdin.once("drain", resolve));
    }

    const readResult = await this.readUntilDelimiter(session, delimiter, timeoutMs);
    const { exitCode, isTimeout, stderr, stdout } = readResult;
    session.lastUsedAt = Date.now();

    const { stdout: output, userCodeFailed } = this.extractUserCodeOutcome(
      session.language,
      stdout,
      delimiter
    );

    return {
      executionTimeMs: Date.now() - startTime,
      exitCode,
      isTimeout,
      stderr,
      stdout: output,
      success:
        this.readCompletion(readResult) === "delimiter" &&
        exitCode === 0 &&
        !isTimeout &&
        !userCodeFailed,
    };
  }

  protected async initializeSession(session: SessionRecord): Promise<void> {
    const workspace = await createWorkspace();
    session.workspace = workspace;
    session.workspaceDir = workspace.dir;
    session.workspaceCleanup = workspace.cleanup;

    const child = spawnSessionProcess(
      session.language,
      workspace.dir,
      () => {
        session.isClosed = true;
      },
      this.options.envFilter
    );

    session.process = child;

    const delimiter = `__OBSKU_INIT_DONE__${Date.now()}__`;
    const payload = formatInitializationPayload(session.language, delimiter);
    if (!child.stdin.writable) {
      throw new Error("Session stdin is not writable");
    }

    const flushed = child.stdin.write(payload);
    if (!flushed) {
      await new Promise<void>((resolve) => child.stdin.once("drain", resolve));
    }

    const initTimeoutMs =
      session.language === "python" ? PYTHON_INIT_TIMEOUT_MS : JS_INIT_TIMEOUT_MS;
    const initResult = await this.readUntilDelimiter(session, delimiter, initTimeoutMs);
    if (session.language === "python" && initResult.exitCode !== 0) {
      throw new Error(initResult.stderr || "Session initialization failed");
    }
  }

  protected isSessionActive(session: SessionRecord): boolean {
    return Boolean(this.getProcess(session));
  }

  protected async terminateSession(session: SessionRecord): Promise<void> {
    const proc = this.getProcess(session);
    if (proc) {
      await terminateProcess(proc);
    }

    if (session.workspaceCleanup) {
      await session.workspaceCleanup();
    }
  }

  private formatPayload(language: SessionLanguage, code: string, delimiter: string): string {
    return formatExecutionPayload(language, code, delimiter);
  }

  private readUntilDelimiter(
    session: SessionRecord,
    delimiter: string,
    timeoutMs: number = DEFAULTS.codeInterpreterSessionTimeout
  ): Promise<ReadUntilDelimiterResult> {
    return readProcessUntilDelimiter(this.getProcess(session), delimiter, timeoutMs);
  }

  private extractUserCodeOutcome(
    language: SessionLanguage,
    stdout: string,
    delimiter: string
  ): UserCodeOutcome {
    return extractUserCodeOutcome(language, stdout, delimiter);
  }

  private getProcess(session: SessionRecord): ReturnType<typeof spawnSessionProcess> | undefined {
    return session.process;
  }

  private readCompletion(result: ReadUntilDelimiterResult): CompletionMode {
    return readCompletion(result);
  }
}
