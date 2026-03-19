/**
 * Type definitions for Bedrock AgentCore code interpreter integration
 */

import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import type {
  CodeExecutor,
  ExecutionOptions,
  ExecutionResult,
  SessionOptions,
} from "@obsku/tool-code-interpreter";
import type { AwsCredentialIdentity } from "@smithy/types";

/**
 * S3 upload configuration for persisting execution outputs
 */
export interface S3UploadConfig {
  /** S3 bucket name */
  bucket: string;
  /** Optional key prefix (e.g., "executions/") */
  prefix?: string;
  /** AWS region for S3 (defaults to us-east-1) */
  region?: string;
}

/**
 * Options for creating an AgentCore-based code executor
 */
export interface AgentCoreExecutorOptions {
  /** Optional pre-configured Bedrock AgentCore client */
  client?: BedrockAgentCoreClient;
  /** Optional identifier for the code interpreter resource */
  codeInterpreterIdentifier?: string;
  /** Optional AWS credentials */
  credentials?: AwsCredentialIdentity;
  /** AWS region for Bedrock AgentCore service */
  region: string;
  /** Optional S3 upload config for persisting outputs */
  s3Upload?: S3UploadConfig;
}

/**
 * Extended session options for AgentCore sessions
 */
export interface AgentCoreSessionOptions extends SessionOptions {
  /** Optional session timeout in seconds */
  sessionTimeoutSeconds?: number;
}

// Re-export types from @obsku/tool-code-interpreter

/**
 * The lifecycle stage at which an AgentCore executor error occurred.
 */
export type ExecutorStage =
  | "startSession"
  | "uploadInputFiles"
  | "execute"
  | "parseOutput"
  | "uploadToS3"
  | "cleanup";

/**
 * Extended execution result returned by AgentCoreExecutor.
 * Adds observable stage-failure and cleanup-error context without altering
 * the base ExecutionResult contract.
 */
export interface AgentCoreExecutionResult extends ExecutionResult {
  /** Error from session cleanup (stopSession), if any. Primary result fields are not affected. */
  cleanupError?: string;
  /** The lifecycle stage that failed when a stage-level error was thrown. */
  failedStage?: ExecutorStage;
}
export type { CodeExecutor, ExecutionOptions, ExecutionResult };
