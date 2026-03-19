/**
 * AgentCore Code Interpreter - Main Entry Point
 *
 * Drop-in replacement for local code interpreter using AWS Bedrock AgentCore.
 */

import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { buildCodeInterpreterPlugin } from "@obsku/tool-code-interpreter/plugin-builder";
import { AgentCoreExecutor } from "./executor";
import { AgentCoreSessionManager } from "./session-manager";
import type { AgentCoreExecutorOptions, S3UploadConfig } from "./types";

export type { AgentCoreExecutorOptions, S3UploadConfig };

/**
 * Creates a code interpreter plugin using AWS Bedrock AgentCore.
 * Provides stateless and stateful code execution via managed Bedrock service.
 */
export function createAgentCoreCodeInterpreter(opts: AgentCoreExecutorOptions) {
  const codeInterpreterIdentifier = opts.codeInterpreterIdentifier ?? "aws.codeinterpreter.v1";

  // Create shared client if not provided
  const client =
    opts.client ??
    new BedrockAgentCoreClient({
      credentials: opts.credentials,
      region: opts.region,
    });

  const executor = new AgentCoreExecutor({
    client,
    codeInterpreterIdentifier,
    credentials: opts.credentials,
    region: opts.region,
    s3Upload: opts.s3Upload,
  });

  const sessionManager = new AgentCoreSessionManager(
    opts.region,
    codeInterpreterIdentifier,
    client
  );

  return buildCodeInterpreterPlugin({
    description:
      "Execute Python, JavaScript, or TypeScript code using AWS Bedrock AgentCore Code Interpreter",
    executor,
    securityWarning:
      "Warning: This tool executes arbitrary code remotely via AWS Bedrock. Validate inputs, avoid secrets, and review outputs carefully before taking any action.",
    sessionManager,
  });
}

/**
 * Default code interpreter instance using AgentCore.
 * Requires region to be set via AWS_REGION env var or default AWS credentials chain.
 */
export const codeInterpreter = createAgentCoreCodeInterpreter;

export default codeInterpreter;
