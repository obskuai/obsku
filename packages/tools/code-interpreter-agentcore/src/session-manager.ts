import {
  BedrockAgentCoreClient,
  InvokeCodeInterpreterCommand,
  type InvokeCodeInterpreterCommandInput,
  StartCodeInterpreterSessionCommand,
  StopCodeInterpreterSessionCommand,
  type ToolName,
} from "@aws-sdk/client-bedrock-agentcore";
import { DEFAULTS } from "@obsku/framework";
import type {
  BaseSessionRecord,
  ExecutionResult,
  SupportedLanguage,
} from "@obsku/tool-code-interpreter";
import { BaseSessionManager } from "@obsku/tool-code-interpreter";
import { serializeInputFiles } from "./file-ops";
import { collectStructuredContent, type StructuredContent } from "./parser";

export interface AgentCoreSessionRecord extends BaseSessionRecord<SupportedLanguage> {
  agentCoreSessionId: string;
  codeInterpreterIdentifier: string;
}

export class AgentCoreSessionManager extends BaseSessionManager<AgentCoreSessionRecord> {
  private readonly client: BedrockAgentCoreClient;
  private readonly codeInterpreterIdentifier: string;

  constructor(region: string, codeInterpreterIdentifier: string, client?: BedrockAgentCoreClient) {
    super();
    this.codeInterpreterIdentifier = codeInterpreterIdentifier;
    this.client = client ?? new BedrockAgentCoreClient({ region });
  }

  protected extendSessionRecord(
    baseRecord: BaseSessionRecord<SupportedLanguage>
  ): AgentCoreSessionRecord {
    return {
      ...baseRecord,
      agentCoreSessionId: "",
      codeInterpreterIdentifier: this.codeInterpreterIdentifier,
    };
  }

  protected async executeSession(
    session: AgentCoreSessionRecord,
    code: string
  ): Promise<ExecutionResult> {
    const options = session.pendingExecutionOptions;
    const abortSignal = AbortSignal.timeout(
      options?.timeoutMs ?? DEFAULTS.codeInterpreterExecTimeout
    );
    const language = options?.language ?? session.language;

    if (options?.inputFiles?.size) {
      await this.invokeStructuredContent(
        session,
        "writeFiles",
        { files: serializeInputFiles(options.inputFiles) },
        abortSignal
      );
    }

    const startedAt = Date.now();
    const structured = await this.invokeStructuredContent(
      session,
      "executeCode",
      { code, language },
      abortSignal
    );
    session.lastUsedAt = Date.now();

    const exitCode = structured?.exitCode;
    const stdout = structured?.stdout ?? "";
    const stderr = structured?.stderr ?? "";
    const executionTimeMs =
      typeof structured?.executionTime === "number"
        ? structured.executionTime
        : Date.now() - startedAt;
    const isTimeout = abortSignal.aborted;

    return {
      executionTimeMs,
      exitCode,
      isTimeout,
      stderr,
      stdout,
      success: exitCode === 0,
    };
  }

  protected async initializeSession(session: AgentCoreSessionRecord): Promise<void> {
    const sessionTimeoutSeconds = Math.ceil(session.maxDurationMs / DEFAULTS.msPerSecond);
    const response = await this.client.send(
      new StartCodeInterpreterSessionCommand({
        codeInterpreterIdentifier: session.codeInterpreterIdentifier,
        sessionTimeoutSeconds,
      })
    );

    if (!response.sessionId) {
      throw new Error("Failed to start AgentCore code interpreter session");
    }

    session.agentCoreSessionId = response.sessionId;
  }

  protected isSessionActive(session: AgentCoreSessionRecord): boolean {
    return Boolean(session.agentCoreSessionId);
  }

  protected async terminateSession(session: AgentCoreSessionRecord): Promise<void> {
    if (!session.agentCoreSessionId) {
      return;
    }

    await this.client.send(
      new StopCodeInterpreterSessionCommand({
        codeInterpreterIdentifier: session.codeInterpreterIdentifier,
        sessionId: session.agentCoreSessionId,
      })
    );
  }

  private async invokeStructuredContent(
    session: AgentCoreSessionRecord,
    name: ToolName,
    args: Record<string, unknown> | undefined,
    abortSignal?: AbortSignal
  ): Promise<StructuredContent | undefined> {
    const input: InvokeCodeInterpreterCommandInput = {
      codeInterpreterIdentifier: session.codeInterpreterIdentifier,
      name,
      sessionId: session.agentCoreSessionId,
    };

    if (args !== undefined) {
      input.arguments = args;
    }

    const response = await this.client.send(
      new InvokeCodeInterpreterCommand(input),
      abortSignal ? { abortSignal } : undefined
    );

    return collectStructuredContent(response.stream);
  }
}
