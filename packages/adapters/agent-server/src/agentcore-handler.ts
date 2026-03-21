import type { AgentEvent, DefaultPublicPayload, LLMProvider, OutputPolicy } from "@obsku/framework";
import { getErrorMessage, getOutputPolicy } from "@obsku/framework";

import { HTTP_STATUS } from "./constants";
import {
  createHandlerErrorResponse,
  createServerConfig,
  parseJsonRequest,
  resolveRequestProvider,
  type TransportEventPayload,
  wrapTransportEventCallback,
} from "./handler-utils";
import { parseAgentCoreRequest } from "./parse-request";
import { type AgentLike, createSSEStream, createWriteErr, type ServeOptions } from "./shared";
import {
  contentBlockDelta,
  contentBlockStart,
  contentBlockStop,
  messageStart,
  messageStop,
  metadata,
  toolUseContentBlockDelta,
  toolUseContentBlockStart,
} from "./strands-sse";

export interface AgentCoreRequest {
  message?: string;
  messages?: Array<{ content: string | Array<{ text: string }>; role: string }>;
  model?: string | { modelId: string; region?: string; type?: string };
  prompt?: Array<{ text: string }>;
  session_id?: string;
  system_prompt?: string;
}

type StreamChunkData = Omit<Extract<AgentEvent, { type: "stream.chunk" }>, "timestamp" | "type">;
type ToolCallData = Omit<Extract<AgentEvent, { type: "tool.call" }>, "timestamp" | "type">;
type AgentCompleteData = Omit<
  Extract<AgentEvent, { type: "agent.complete" }>,
  "timestamp" | "type"
>;
type AgentCoreTransportEvent = TransportEventPayload<DefaultPublicPayload<AgentEvent>>;
const agentCoreTransportPolicy = getOutputPolicy("default") as OutputPolicy<
  AgentEvent,
  AgentCoreTransportEvent
>;

export function serveAgentCore(
  a: AgentLike,
  defaultProvider: LLMProvider,
  opts: ServeOptions | undefined,
  port: number
): ReturnType<typeof Bun.serve> {
  const writeErr = createWriteErr(opts?.logger);

  return createServerConfig(port, "0.0.0.0", writeErr, async (req, url) => {
    if (req.method !== "POST" || (url.pathname !== "/invocations" && url.pathname !== "/chat")) {
      return new Response("Not Found", { status: HTTP_STATUS.NOT_FOUND });
    }

    const jsonResult = await parseJsonRequest<unknown>(req, {
      tag: "[AgentCore]",
      writeErr,
    });
    if (!jsonResult.ok) {
      return jsonResult.response;
    }
    const body = jsonResult.body;

    let parsed: ReturnType<typeof parseAgentCoreRequest>;
    try {
      parsed = parseAgentCoreRequest(body);
    } catch (error: unknown) {
      return createHandlerErrorResponse(
        error instanceof Error ? getErrorMessage(error) : "Invalid request"
      );
    }

    const providerResult = await resolveRequestProvider({
      defaultProvider,
      failureMessage: "Provider creation failed",
      model: parsed.model,
      providerFactory: opts?.providerFactory,
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      tag: "[AgentCore]",
      writeErr,
    });
    if (!providerResult.ok) {
      return providerResult.response;
    }

    const provider = providerResult.provider;

    return createSSEStream(
      req.signal,
      async (send, isAborted) => {
        let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        let blockIndex = 0;
        let textBlockOpen = false;

        const ensureTextBlock = () => {
          if (!textBlockOpen) {
            send(contentBlockStart(blockIndex));
            textBlockOpen = true;
          }
        };

        const closeTextBlock = () => {
          if (textBlockOpen) {
            send(contentBlockStop(blockIndex));
            blockIndex++;
            textBlockOpen = false;
          }
        };

        const onEvent = (event: AgentCoreTransportEvent) => {
          if (isAborted()) return;

          if (event.type === "stream.chunk") {
            const chunk = event.data as StreamChunkData;
            ensureTextBlock();
            send(contentBlockDelta(blockIndex, chunk.content));
          }

          if (event.type === "tool.call") {
            const toolCall = event.data as ToolCallData;
            closeTextBlock();
            send(toolUseContentBlockStart(blockIndex, toolCall.toolUseId, toolCall.toolName));
            send(
              toolUseContentBlockDelta(
                blockIndex,
                typeof toolCall.args === "string" ? toolCall.args : JSON.stringify(toolCall.args)
              )
            );
            send(contentBlockStop(blockIndex));
            blockIndex++;
          }

          if (event.type === "agent.complete") {
            const completed = event.data as AgentCompleteData;
            if (!completed.usage) return;

            usage = {
              inputTokens: completed.usage.totalInputTokens,
              outputTokens: completed.usage.totalOutputTokens,
              totalTokens: completed.usage.totalInputTokens + completed.usage.totalOutputTokens,
            };
          }
        };

        try {
          send(messageStart());

          await a.run(parsed.input, provider, {
            messages: parsed.messages,
            onEvent: wrapTransportEventCallback<AgentCoreTransportEvent>(
              onEvent,
              agentCoreTransportPolicy
            ),
            sessionId: parsed.sessionId,
          });

          closeTextBlock();
          send(messageStop("end_turn"));
          send(metadata(usage));
        } catch (error: unknown) {
          const msg = error instanceof Error ? getErrorMessage(error) : "Unknown error";
          ensureTextBlock();
          send(contentBlockDelta(blockIndex, `\n[Error: ${msg}]`));
          closeTextBlock();
          send(messageStop("error"));
          send(metadata({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }));
        }
      },
      createWriteErr(opts?.logger)
    );
  });
}
