import { z } from "zod";
import { getErrorMessage } from "../utils";
import type { JsonRpcResponse } from "./types";
import { JsonRpcError, RemoteAgentError } from "./types";

const JsonRpcResponseSchema = z.object({
  error: z
    .object({ code: z.number(), data: z.unknown().optional(), message: z.string() })
    .optional(),
  id: z.string(),
  jsonrpc: z.literal("2.0"),
  result: z
    .object({
      artifacts: z
        .array(
          z.object({
            artifactId: z.string().optional(),
            name: z.string().optional(),
            parts: z
              .array(z.object({ kind: z.string().optional(), text: z.string().optional() }))
              .optional(),
          })
        )
        .optional(),
    })
    .optional(),
});

export function createTimeoutError(
  agentName: string,
  timeout: number,
  cause: unknown
): RemoteAgentError {
  return new RemoteAgentError(agentName, `Request timed out after ${timeout}ms`, cause);
}

export async function parseJsonRpcResponse(
  agentName: string,
  response: Response
): Promise<JsonRpcResponse> {
  try {
    const raw: unknown = await response.json();
    const result = JsonRpcResponseSchema.safeParse(raw);
    if (!result.success) {
      throw new RemoteAgentError(agentName, `Invalid JSON-RPC response: ${result.error.message}`, {
        issues: result.error.issues,
        raw,
      });
    }
    return result.data;
  } catch (error: unknown) {
    if (error instanceof RemoteAgentError) {
      throw error;
    }
    throw new RemoteAgentError(
      agentName,
      `Invalid JSON response: ${getErrorMessage(error)}`,
      error
    );
  }
}

export function unwrapJsonRpcText(agentName: string, json: JsonRpcResponse): string {
  if (json.error) {
    throw new JsonRpcError(json.error.code, json.error.message, json.error.data);
  }

  const artifacts = json.result?.artifacts;
  if (!artifacts || !Array.isArray(artifacts) || artifacts.length === 0) {
    throw new RemoteAgentError(agentName, "No artifacts in response");
  }

  const firstArtifact = artifacts[0];
  const parts = firstArtifact.parts;
  if (!parts || !Array.isArray(parts) || parts.length === 0) {
    throw new RemoteAgentError(agentName, "No parts in first artifact");
  }

  const text = parts[0].text;
  if (typeof text !== "string") {
    throw new RemoteAgentError(agentName, "First part has no text content");
  }

  return text;
}
