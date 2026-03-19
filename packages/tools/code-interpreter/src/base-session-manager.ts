import { DEFAULTS, getErrorMessage, debugLog } from "@obsku/framework";
import { randomUUID } from "node:crypto";
import { createErrorResult } from "./constants";
import type { ExecutionOptions, ExecutionResult, SessionOptions, SupportedLanguage } from "./types";

export interface BaseSessionRecord<TLanguage extends SupportedLanguage = SupportedLanguage> {
  createdAt: number;
  id: string;
  idleTimeoutMs: number;
  init: Promise<void>;
  isClosed: boolean;
  isExecuting: boolean;
  language: TLanguage;
  lastUsedAt: number;
  maxDurationMs: number;
  pendingExecutionOptions?: ExecutionOptions;
}

export abstract class BaseSessionManager<
  TRecord extends BaseSessionRecord<TLanguage>,
  TLanguage extends SupportedLanguage = SupportedLanguage,
> {
  protected readonly sessions = new Map<string, TRecord>();

  create(language: TLanguage, opts: Partial<SessionOptions> = {}): string {
    this.assertCanCreateSession();
    const sessionId = randomUUID();
    const now = Date.now();
    const baseRecord = this.createBaseSessionRecord(sessionId, language, now, opts);
    const session = this.extendSessionRecord(baseRecord);
    session.init = this.initializeSession(session);
    this.sessions.set(sessionId, session);
    return sessionId;
  }

  execute(options: ExecutionOptions & { sessionId: string }): Promise<ExecutionResult>;
  execute(sessionId: string, code: string): Promise<ExecutionResult>;
  async execute(
    sessionIdOrOptions: string | (ExecutionOptions & { sessionId: string }),
    code?: string
  ): Promise<ExecutionResult> {
    if (typeof sessionIdOrOptions === "string") {
      return this.executeCore(sessionIdOrOptions, code ?? "");
    }

    const session = this.sessions.get(sessionIdOrOptions.sessionId);
    if (!session) {
      return this.executeCore(sessionIdOrOptions.sessionId, sessionIdOrOptions.code);
    }

    session.pendingExecutionOptions = sessionIdOrOptions;

    try {
      return await this.executeCore(sessionIdOrOptions.sessionId, sessionIdOrOptions.code);
    } finally {
      if (session.pendingExecutionOptions === sessionIdOrOptions) {
        session.pendingExecutionOptions = undefined;
      }
    }
  }

  private async executeCore(sessionId: string, code: string): Promise<ExecutionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return createErrorResult(`Session ${sessionId} not found`);
    }

    await session.init;

    if (!this.isSessionActive(session) || session.isClosed) {
      return createErrorResult(`Session ${sessionId} is not active`);
    }

    const now = Date.now();
    if (now - session.createdAt > session.maxDurationMs) {
      await this.destroy(sessionId);
      return createErrorResult(`Session ${sessionId} exceeded max duration`);
    }

    if (now - session.lastUsedAt > session.idleTimeoutMs) {
      await this.destroy(sessionId);
      return createErrorResult(`Session ${sessionId} exceeded idle timeout`);
    }

    if (session.isExecuting) {
      return createErrorResult(`Session ${sessionId} is already executing`);
    }

    session.isExecuting = true;
    try {
      return await this.executeSession(session, code);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      return createErrorResult(message);
    } finally {
      session.isExecuting = false;
    }
  }

  async destroy(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.isClosed = true;
    this.sessions.delete(sessionId);

    try {
      await session.init;
    } catch (error: unknown) {
      debugLog(`session init failed during destroy: ${error}`);
    }

    await this.terminateSession(session);
  }

  async destroyAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.destroy(id);
    }
  }

  protected createBaseSessionRecord(
    sessionId: string,
    language: TLanguage,
    now: number,
    opts: Partial<SessionOptions>
  ): BaseSessionRecord<TLanguage> {
    return {
      createdAt: now,
      id: sessionId,
      idleTimeoutMs: opts.idleTimeoutMs ?? DEFAULTS.codeInterpreterIdleTimeout,
      init: Promise.resolve(),
      isClosed: false,
      isExecuting: false,
      language,
      lastUsedAt: now,
      maxDurationMs: opts.maxDurationMs ?? DEFAULTS.codeInterpreterMaxDuration,
    };
  }

  protected assertCanCreateSession(): void {}

  protected abstract extendSessionRecord(baseRecord: BaseSessionRecord<TLanguage>): TRecord;
  protected abstract executeSession(session: TRecord, code: string): Promise<ExecutionResult>;
  protected abstract initializeSession(session: TRecord): Promise<void>;
  protected abstract isSessionActive(session: TRecord): boolean;
  protected abstract terminateSession(session: TRecord): Promise<void>;
}
