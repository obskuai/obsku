import type { AgentEvent, DefaultPublicPayload, LLMProvider, OutputPolicy } from "@obsku/framework";
import { getOutputPolicy } from "@obsku/framework";

import { HTTP_STATUS, JSONRPC_VERSION } from "./constants";
import {
  createExecutionContext,
  createJsonRpcErrorResponse,
  createServerConfig,
  executeWithContext,
  getHttpErrorMessage,
  parseJsonRequest,
  runAgentStream,
} from "./handler-utils";
import { type AgentLike, createWriteErr, formatSSEMessage, type ServeOptions } from "./shared";

type StreamChunkData = Omit<Extract<AgentEvent, { type: "stream.chunk" }>, "timestamp" | "type">;
type A2ATransportEvent = DefaultPublicPayload<AgentEvent>;
const a2aTransportPolicy = getOutputPolicy("default") as OutputPolicy<
  AgentEvent,
  A2ATransportEvent
>;

export interface AgentCard {
  capabilities: { streaming: boolean };
  defaultInputModes: Array<string>;
  defaultOutputModes: Array<string>;
  description: string;
  name: string;
  preferredTransport: string;
  protocolVersion: string;
  skills: Array<{
    description: string;
    id: string;
    name: string;
    tags: Array<string>;
  }>;
  version: string;
}

export interface A2ARequest {
  id: string | number | null;
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: {
    message?: {
      messageId?: string;
      parts: Array<{ kind: string; text?: string }>;
      role: string;
    };
  };
}

export interface A2AResponse {
  error?: {
    code: number;
    message: string;
  };
  id: string | number | null;
  jsonrpc: typeof JSONRPC_VERSION;
  result?: {
    artifacts: Array<{
      artifactId: string;
      name: string;
      parts: Array<{ kind: string; text: string }>;
    }>;
  };
}

export function handleA2AStream(
  a: AgentLike,
  provider: LLMProvider,
  body: A2ARequest,
  signal: AbortSignal,
  logger?: { error(msg: string): void }
): Response {
  const textPart = body.params?.message?.parts?.find((p) => p.kind === "text");
  const prompt = textPart?.text ?? "";
  const taskId = crypto.randomUUID();
  const reqId = body.id;

  return runAgentStream<A2ATransportEvent>({
    agent: a,
    buildCallbacks: ({ isAborted, send }) => {
      const sendJson = (data: unknown) => send(formatSSEMessage({ data }));
      return {
        onComplete: () => {
          sendJson({
            id: reqId,
            jsonrpc: JSONRPC_VERSION,
            result: { task: { status: { state: "completed" }, taskId } },
          });
        },
        onError: (caughtError) => {
          sendJson({
            id: reqId,
            jsonrpc: JSONRPC_VERSION,
            result: {
              task: {
                status: {
                  error: getHttpErrorMessage(caughtError),
                  state: "failed",
                },
                taskId,
              },
            },
          });
        },
        onEvent: (event) => {
          if (isAborted()) return;
          if (event.type !== "stream.chunk") return;
          const chunk = event.data as StreamChunkData;
          sendJson({
            id: reqId,
            jsonrpc: JSONRPC_VERSION,
            result: {
              artifactUpdate: {
                artifact: { parts: [{ kind: "text", text: chunk.content }] },
                taskId,
              },
            },
          });
        },
        onPreRun: () => {
          sendJson({
            id: reqId,
            jsonrpc: JSONRPC_VERSION,
            result: { task: { status: { state: "working" }, taskId } },
          });
        },
      };
    },
    input: prompt,
    policy: a2aTransportPolicy,
    provider,
    signal,
    writeErr: createWriteErr(logger),
  });
}

export function serveA2A(
  a: AgentLike,
  provider: LLMProvider,
  opts: ServeOptions | undefined,
  port: number
): ReturnType<typeof Bun.serve> {
  const agentCard: AgentCard = {
    capabilities: { streaming: opts?.streaming ?? false },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    description: opts?.description ?? `${a.name} agent`,
    name: a.name,
    preferredTransport: "JSONRPC",
    protocolVersion: "0.3.0",
    skills: (opts?.skills ?? []).map((s, i) => ({
      description: s,
      id: `skill-${i}`,
      name: s,
      tags: [],
    })),
    version: "1.0.0",
  };

  const writeErr = createWriteErr(opts?.logger);

  return createServerConfig(port, "0.0.0.0", writeErr, async (req, url) => {
    if (req.method === "GET" && url.pathname === "/.well-known/agent-card.json") {
      return Response.json(agentCard);
    }

    if (req.method !== "POST" || url.pathname !== "/") {
      return new Response("Not Found", { status: HTTP_STATUS.NOT_FOUND });
    }

    const parsed = await parseJsonRequest<A2ARequest>(req, { tag: "[A2A]", writeErr });
    if (!parsed.ok) {
      return Response.json(createJsonRpcErrorResponse(-32_700, "Parse error", null), {
        status: HTTP_STATUS.BAD_REQUEST,
      });
    }
    const body = parsed.body;

    if (body.method === "message/send") {
      const textPart = body.params?.message?.parts?.find((p) => p.kind === "text");
      const prompt = textPart?.text ?? "";
      const ctx = createExecutionContext({ input: prompt, provider });
      const result = await executeWithContext(a, ctx);
      return Response.json({
        id: body.id,
        jsonrpc: JSONRPC_VERSION,
        result: {
          artifacts: [
            {
              artifactId: crypto.randomUUID(),
              name: "agent_response",
              parts: [{ kind: "text", text: result }],
            },
          ],
        },
      } as A2AResponse);
    }

    if (body.method === "message/stream") {
      return handleA2AStream(a, provider, body, req.signal, opts?.logger);
    }

    return Response.json(createJsonRpcErrorResponse(-32_601, "Method not found", body.id), {
      status: HTTP_STATUS.BAD_REQUEST,
    });
  });
}
