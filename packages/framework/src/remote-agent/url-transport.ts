import { DEFAULTS } from "../defaults";
import { getErrorMessage, generateId } from "../utils";
import { JSONRPC_VERSION } from "./constants";
import { createTimeoutError, parseJsonRpcResponse, unwrapJsonRpcText } from "./shared";
import type { JsonRpcRequest, RemoteAgentUrlConfig } from "./types";
import { RemoteAgentError } from "./types";

function createJsonRpcRequest(task: string): JsonRpcRequest {
  return {
    id: generateId(),
    jsonrpc: JSONRPC_VERSION,
    method: "message/send",
    params: {
      message: {
        messageId: generateId(),
        parts: [{ kind: "text", text: task }],
        role: "user",
      },
    },
  };
}

export async function callRemoteAgentUrl(
  agentName: string,
  config: RemoteAgentUrlConfig,
  task: string
): Promise<string> {
  const timeout = config.timeout ?? DEFAULTS.remoteAgentTimeout;
  const request = createJsonRpcRequest(task);

  let response: Response;
  try {
    response = await fetch(config.url, {
      body: JSON.stringify(request),
      headers: {
        "Content-Type": DEFAULTS.http.jsonContentType,
      },
      method: "POST",
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw createTimeoutError(agentName, timeout, error);
    }
    throw new RemoteAgentError(
      agentName,
      `Failed to connect to remote agent: ${getErrorMessage(error)}`,
      error
    );
  }

  if (!response.ok) {
    throw new RemoteAgentError(agentName, `HTTP error ${response.status}: ${response.statusText}`);
  }

  const json = await parseJsonRpcResponse(agentName, response);
  return unwrapJsonRpcText(agentName, json);
}
