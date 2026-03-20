import {
  BedrockAgentCoreClient,
  type CodeInterpreterStreamOutput,
} from "@aws-sdk/client-bedrock-agentcore";

import { DEFAULTS } from "@obsku/framework";
import type { SupportedLanguage } from "@obsku/tool-code-interpreter";
import { createStructuredContentInvoker } from "./executor-invoke";
import { attachCleanupError, buildExecutionResult, buildFailureResult } from "./executor-result";
import { startSession, stopSession } from "./executor-session";
import { runExecutionStages } from "./executor-stage-orchestration";
import { uploadResultToS3 } from "./executor-upload";
import { collectStructuredContent as collectContentStream, type StructuredContent } from "./parser";
import type { S3UploadConfig } from "./s3-uploader";
import type {
  AgentCoreExecutionResult,
  AgentCoreExecutorOptions,
  CodeExecutor,
  ExecutionOptions,
} from "./types";

export class AgentCoreExecutor implements CodeExecutor {
  readonly name = "agentcore";
  readonly supportedLanguages: Array<SupportedLanguage> = ["python", "javascript", "typescript"];

  private client: BedrockAgentCoreClient;
  private codeInterpreterIdentifier: string;
  private s3Upload?: S3UploadConfig;

  constructor(options: AgentCoreExecutorOptions) {
    this.codeInterpreterIdentifier = options.codeInterpreterIdentifier ?? "aws.codeinterpreter.v1";
    this.s3Upload = options.s3Upload;
    this.client =
      options.client ??
      new BedrockAgentCoreClient({ credentials: options.credentials, region: options.region });
  }

  async initialize(): Promise<void> {}
  async dispose(): Promise<void> {
    if (typeof this.client.destroy === "function") {
      this.client.destroy();
    }
  }

  async execute(options: ExecutionOptions): Promise<AgentCoreExecutionResult> {
    const abortSignal = AbortSignal.timeout(
      options.timeoutMs ?? DEFAULTS.codeInterpreterExecTimeout
    );
    let sessionId: string | undefined;

    try {
      sessionId = await startSession(this.client, this.codeInterpreterIdentifier, abortSignal);
      const invoke = createStructuredContentInvoker(
        this.client,
        this.codeInterpreterIdentifier,
        sessionId
      );
      const { execution, outputFiles } = await runExecutionStages(invoke, options, abortSignal);
      const result = buildExecutionResult(execution.content, execution.startedAt, outputFiles);
      const uploadedResult = await uploadResultToS3(result, sessionId, this.s3Upload);
      return attachCleanupError(
        uploadedResult,
        await stopSession(this.client, this.codeInterpreterIdentifier, sessionId)
      );
    } catch (error: unknown) {
      return attachCleanupError(
        buildFailureResult(error),
        await stopSession(this.client, this.codeInterpreterIdentifier, sessionId)
      );
    }
  }

  public async collectStructuredContent(
    stream?: AsyncIterable<CodeInterpreterStreamOutput>
  ): Promise<StructuredContent | undefined> {
    return collectContentStream(stream);
  }
}
