import type { AgentEvent, LLMProvider, SessionEndEvent } from "@obsku/framework";
import { getErrorMessage } from "@obsku/framework";

import { HTTP_STATUS } from "./constants";
import {
  createHandlerErrorResponse,
  createServerConfig,
  parseJsonRequest,
  resolveRequestProvider,
  runAgentStream,
} from "./handler-utils";
import { parseAgentCoreRequest } from "./parse-request";
import { type AgentLike, createWriteErr, type ServeOptions } from "./shared";
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

/** Tracks content block indices for Strands SSE translation. */
interface StrandsBlockState {
  blockIndex: number;
  inTextBlock: boolean;
  messageStarted: boolean;
}

function openTextBlockIfNeeded(send: (data: string) => void, state: StrandsBlockState): void {
  if (!state.messageStarted) {
    send(messageStart());
    state.messageStarted = true;
  }
  if (!state.inTextBlock) {
    state.blockIndex++;
    send(contentBlockStart(state.blockIndex));
    state.inTextBlock = true;
  }
}

function closeTextBlockIfOpen(send: (data: string) => void, state: StrandsBlockState): void {
  if (state.inTextBlock) {
    send(contentBlockStop(state.blockIndex));
    state.inTextBlock = false;
  }
}

/**
 * Translate a framework AgentEvent into Strands SSE format.
 *
 * Strands wire format: `data: {"event":{...}}\n\n`
 * - messageStart / messageStop — message boundaries
 * - contentBlockStart / contentBlockDelta / contentBlockStop — content chunks
 * - toolUseContentBlockStart / toolUseContentBlockDelta — tool invocations
 * - metadata — usage stats
 */
function sendStrandsEvent(
  send: (data: string) => void,
  state: StrandsBlockState,
  event: AgentEvent
): void {
  switch (event.type) {
    case "turn.start": {
      state.blockIndex = -1;
      state.inTextBlock = false;
      state.messageStarted = false;
      send(messageStart());
      state.messageStarted = true;
      break;
    }

    case "stream.chunk": {
      openTextBlockIfNeeded(send, state);
      send(contentBlockDelta(state.blockIndex, event.content));
      break;
    }

    case "tool.call": {
      closeTextBlockIfOpen(send, state);
      if (!state.messageStarted) {
        send(messageStart());
        state.messageStarted = true;
      }
      state.blockIndex++;
      send(toolUseContentBlockStart(state.blockIndex, event.toolUseId, event.toolName));
      send(
        toolUseContentBlockDelta(
          state.blockIndex,
          typeof event.args === "string" ? event.args : JSON.stringify(event.args)
        )
      );
      send(contentBlockStop(state.blockIndex));
      break;
    }

    case "agent.complete": {
      if (event.usage) {
        const inputTokens = event.usage.totalInputTokens;
        const outputTokens = event.usage.totalOutputTokens;
        send(
          metadata({
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          })
        );
      }
      break;
    }

    case "turn.end": {
      closeTextBlockIfOpen(send, state);
      if (state.messageStarted) {
        send(messageStop("end_turn"));
        state.messageStarted = false;
      }
      break;
    }

    // Events with no Strands equivalent — skip silently
    case "session.start":
    case "session.end":
    case "stream.start":
    case "stream.end":
    case "tool.result":
    case "tool.progress":
    case "tool.stream.chunk":
    case "agent.thinking":
    case "agent.transition":
      break;

    // All other events (graph, checkpoint, etc.) — skip
    default:
      break;
  }
}

function createStrandsEventHandler(
  send: (data: string) => void,
  isAborted: () => boolean,
  close: () => void,
  state: StrandsBlockState
): (event: AgentEvent) => void {
  return (event: AgentEvent) => {
    if (isAborted()) {
      return;
    }

    sendStrandsEvent(send, state, event);
    if (event.type === "session.end") {
      close();
    }
  };
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

    return runAgentStream({
      agent: a,
      buildCallbacks: ({ close, isAborted, send }) => {
        const state: StrandsBlockState = {
          blockIndex: -1,
          inTextBlock: false,
          messageStarted: false,
        };
        return {
          onError: (error) => {
            // On error: close any open blocks, emit messageStop, then close stream
            closeTextBlockIfOpen(send, state);
            if (state.messageStarted) {
              send(messageStop("error"));
              state.messageStarted = false;
            }
            close();
          },
          onEvent: createStrandsEventHandler(send, isAborted, close, state),
        };
      },
      input: parsed.input,
      messages: parsed.messages,
      provider: providerResult.provider,
      signal: req.signal,
      writeErr: createWriteErr(opts?.logger),
    });
  });
}
