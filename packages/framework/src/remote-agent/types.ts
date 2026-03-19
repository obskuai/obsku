// =============================================================================
// @obsku/framework — Remote Agent types, JSON-RPC interfaces, error classes
// =============================================================================

// --- Configuration Types ---

export interface RemoteAgentUrlConfig {
  /** Request timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number;
  /** URL of the remote A2A agent endpoint */
  url: string;
}

export interface RemoteAgentArnConfig {
  /** ARN of the AgentCore-hosted agent */
  arn: string;
  /** AWS region (default: us-east-1) */
  region?: string;
  /** Request timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number;
}

export type RemoteAgentConfig = RemoteAgentUrlConfig | RemoteAgentArnConfig;

// --- JSON-RPC Types ---

export interface JsonRpcRequest {
  id: string;
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcErrorData {
  code: number;
  data?: unknown;
  message: string;
}

export interface JsonRpcResponse {
  error?: JsonRpcErrorData;
  id: string;
  jsonrpc: "2.0";
  result?: {
    artifacts?: Array<{
      artifactId?: string;
      name?: string;
      parts?: Array<{
        kind?: string;
        text?: string;
      }>;
    }>;
  };
}

// --- Error Classes ---

export class RemoteAgentError extends Error {
  readonly _tag = "RemoteAgentError" as const;
  constructor(
    readonly agentName: string,
    message: string,
    readonly cause?: unknown
  ) {
    super(`Remote agent "${agentName}" failed: ${message}`);
    this.name = "RemoteAgentError";
  }
}

export class JsonRpcError extends Error {
  readonly _tag = "JsonRpcError" as const;
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(`JSON-RPC error ${code}: ${message}`);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
  }
}

// --- Helpers ---

export function isUrlConfig(config: RemoteAgentConfig): config is RemoteAgentUrlConfig {
  return "url" in config;
}
