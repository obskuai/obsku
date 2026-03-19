import { DEFAULTS } from "../defaults";
import { formatError } from "../utils";
import { createTimeoutError } from "./shared";
import type { RemoteAgentArnConfig } from "./types";
import { RemoteAgentError } from "./types";

interface AgentCoreOutput {
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>;
  transformToString?: () => Promise<string>;
}

interface AgentCoreResponse {
  output?: AgentCoreOutput;
}

type AwsSdkModule = {
  BedrockAgentCoreClient: new (config: {
    region: string;
  }) => { send: (command: unknown, options?: unknown) => Promise<AgentCoreResponse> };
  InvokeAgentRuntimeCommand: new (input: unknown) => unknown;
};

async function loadAwsSdk(agentName: string): Promise<AwsSdkModule> {
  try {
    const mod = await import("@aws-sdk/client-bedrock-agentcore" as string);
    return mod as AwsSdkModule;
  } catch (error: unknown) {
    throw new RemoteAgentError(agentName, `Failed to load AWS SDK: ${formatError(error)}`, error);
  }
}

function createArnCommand(
  InvokeAgentRuntimeCommand: new (input: unknown) => unknown,
  config: RemoteAgentArnConfig,
  task: string
): unknown {
  const sessionId = `session-${Date.now()}-${crypto.randomUUID()}`;
  return new InvokeAgentRuntimeCommand({
    accept: DEFAULTS.http.jsonContentType,
    agentRuntimeArn: config.arn,
    contentType: DEFAULTS.http.jsonContentType,
    payload: new TextEncoder().encode(JSON.stringify({ task })),
    runtimeSessionId: sessionId,
  });
}

async function parseArnResponse(
  agentName: string,
  output: AgentCoreOutput | undefined
): Promise<string> {
  if (!output) {
    throw new RemoteAgentError(agentName, "No output in agent response");
  }

  if (typeof output.transformToString === "function") {
    const text = await output.transformToString();
    if (!text) {
      throw new RemoteAgentError(agentName, "Empty response from agent");
    }
    return text;
  }

  if (Symbol.asyncIterator in output) {
    const chunks: Array<string> = [];
    const decoder = new TextDecoder();
    for await (const chunk of output as AsyncIterable<Uint8Array>) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }
    const text = chunks.join("");
    if (!text) {
      throw new RemoteAgentError(agentName, "Empty response from agent");
    }
    return text;
  }

  throw new RemoteAgentError(agentName, "No readable output in agent response");
}

function translateAwsError(agentName: string, err: unknown, timeout: number): RemoteAgentError {
  if (err instanceof RemoteAgentError) {
    return err;
  }
  if (err instanceof Error && err.name === "TimeoutError") {
    return createTimeoutError(agentName, timeout, err);
  }

  const awsErr = err as { message?: string; name?: string };
  if (awsErr.name === "AccessDeniedException") {
    return new RemoteAgentError(agentName, `Access denied: check IAM permissions`, err);
  }
  if (awsErr.name === "ResourceNotFoundException") {
    return new RemoteAgentError(agentName, `Agent not found: verify ARN`, err);
  }
  if (awsErr.name === "ThrottlingException") {
    return new RemoteAgentError(agentName, `Rate limited: retry after delay`, err);
  }

  return new RemoteAgentError(agentName, `AWS SDK error: ${formatError(err)}`, err);
}

export async function callRemoteAgentArn(
  agentName: string,
  config: RemoteAgentArnConfig,
  task: string
): Promise<string> {
  const region = config.region ?? "us-east-1";
  const timeout = config.timeout ?? DEFAULTS.remoteAgentTimeout;

  const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = await loadAwsSdk(agentName);
  const client = new BedrockAgentCoreClient({ region });
  const command = createArnCommand(InvokeAgentRuntimeCommand, config, task);

  try {
    const response = await client.send(command, {
      abortSignal: AbortSignal.timeout(timeout),
    });
    return await parseArnResponse(agentName, response.output);
  } catch (error: unknown) {
    throw translateAwsError(agentName, error, timeout);
  }
}
