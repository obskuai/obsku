import type { BaseSessionRecord } from "@obsku/tool-code-interpreter";
import { BaseSessionManager } from "@obsku/tool-code-interpreter";
import { createErrorResult, DEFAULT_MAX_SESSIONS } from "@obsku/tool-code-interpreter";
import type { WasmContext, WasmRuntime } from "./runtimes/types";
import type { ExecutionResult, SupportedLanguage } from "@obsku/tool-code-interpreter";

interface WasmSessionRecord extends BaseSessionRecord<SupportedLanguage> {
  context?: WasmContext;
}

export class WasmSessionManager extends BaseSessionManager<WasmSessionRecord> {
  private readonly maxSessions: number;

  constructor(
    private readonly runtime: WasmRuntime,
    maxSessions: number = DEFAULT_MAX_SESSIONS
  ) {
    super();
    this.maxSessions = maxSessions;
  }

  protected assertCanCreateSession(): void {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Max concurrent sessions (${this.maxSessions}) exceeded`);
    }
  }

  protected extendSessionRecord(
    baseRecord: BaseSessionRecord<SupportedLanguage>
  ): WasmSessionRecord {
    return { ...baseRecord };
  }

  protected async executeSession(
    session: WasmSessionRecord,
    code: string
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    if (!session.context) {
      return createErrorResult(`Session ${session.id} is not active`);
    }
    const result = await session.context.execute(code);
    session.lastUsedAt = Date.now();
    return {
      ...result,
      executionTimeMs: Date.now() - startTime,
    };
  }

  protected async initializeSession(session: WasmSessionRecord): Promise<void> {
    const context = await this.runtime.createContext(session.id);
    session.context = context;
  }

  protected isSessionActive(session: WasmSessionRecord): boolean {
    return Boolean(session.context);
  }

  protected async terminateSession(session: WasmSessionRecord): Promise<void> {
    await this.runtime.destroyContext(session.id);
  }
}
