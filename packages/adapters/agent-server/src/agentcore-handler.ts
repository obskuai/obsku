import type { AgentEvent, LLMProvider } from "@obsku/framework";
import { getErrorMessage } from "@obsku/framework";

import { HTTP_STATUS } from "./constants";
import {
  createHandlerErrorResponse,
  createServerConfig,
  parseJsonRequest,
  resolveRequestProvider,
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

        const onEvent = (event: AgentEvent) => {
          if (isAborted()) return;

          if (event.type === "stream.chunk") {
            ensureTextBlock();
            send(contentBlockDelta(blockIndex, event.content));
          }

          if (event.type === "tool.call") {
            closeTextBlock();
            send(toolUseContentBlockStart(blockIndex, event.toolUseId, event.toolName));
            send(
              toolUseContentBlockDelta(
                blockIndex,
                typeof event.args === "string" ? event.args : JSON.stringify(event.args)
              )
            );
            send(contentBlockStop(blockIndex));
            blockIndex++;
          }

          if (event.type === "agent.complete" && event.usage) {
            usage = {
              inputTokens: event.usage.totalInputTokens,
              outputTokens: event.usage.totalOutputTokens,
              totalTokens: event.usage.totalInputTokens + event.usage.totalOutputTokens,
            };
          }
        };

        try {
          send(messageStart());

          await a.run(parsed.input, provider, {
            messages: parsed.messages,
            onEvent,
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
