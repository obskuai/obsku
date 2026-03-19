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
import { type AgentLike, createWriteErr, formatSSEMessage, type ServeOptions } from "./shared";

export interface AgentCoreRequest {
  message?: string;
  messages?: Array<{ content: string | Array<{ text: string }>; role: string }>;
  model?: string | { modelId: string; region?: string; type?: string };
  prompt?: Array<{ text: string }>;
  session_id?: string;
  system_prompt?: string;
}

interface AgentCoreSSEState {
  currentTurnId?: string;
  sessionEnded: boolean;
  sessionId: string;
}

interface AgentCoreSSEEnvelope {
  data: Record<string, unknown>;
  sessionId: string;
  timestamp: number;
  turnId?: string;
  type: AgentEvent["type"];
}

function createAgentCoreEnvelope(
  event: AgentEvent,
  sessionId: string,
  turnId?: string
): AgentCoreSSEEnvelope {
  const type = event.type;
  // Some legacy events (LegacyContextPrunedEvent, LegacyContextCompactedEvent) omit timestamp;
  // fall back to Date.now() when absent.
  const rawTimestamp: unknown =
    "timestamp" in event ? (event as { timestamp: unknown }).timestamp : undefined;
  const data: Record<string, unknown> = Object.fromEntries(
    Object.entries(event as object).filter(([k]) => k !== "type" && k !== "timestamp")
  );
  return {
    data,
    sessionId,
    timestamp: typeof rawTimestamp === "number" ? rawTimestamp : Date.now(),
    ...(turnId != null ? { turnId } : {}),
    type,
  };
}

function getEventSessionId(event: AgentEvent): string | undefined {
  if ("sessionId" in event && typeof event.sessionId === "string" && event.sessionId.length > 0) {
    return event.sessionId;
  }
  return undefined;
}

function sendAgentCoreEvent(
  send: (data: string) => void,
  state: AgentCoreSSEState,
  event: AgentEvent
): void {
  const eventSessionId = getEventSessionId(event);
  if (eventSessionId) {
    state.sessionId = eventSessionId;
  }

  if (event.type === "turn.start" && "turnId" in event && typeof event.turnId === "string") {
    state.currentTurnId = event.turnId;
  }

  send(
    formatSSEMessage({
      data: createAgentCoreEnvelope(event, state.sessionId, state.currentTurnId),
      event: event.type,
    })
  );

  if (event.type === "turn.end") {
    state.currentTurnId = undefined;
  }
}

function createAgentCoreEventHandler(
  send: (data: string) => void,
  isAborted: () => boolean,
  close: () => void,
  state: AgentCoreSSEState
): (event: AgentEvent) => void {
  return (event: AgentEvent) => {
    if (isAborted()) {
      return;
    }

    sendAgentCoreEvent(send, state, event);
    if (event.type === "session.end") {
      state.sessionEnded = true;
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

    // Protocol-specific callbacks stay at the edge; orchestration is shared.
    return runAgentStream({
      agent: a,
      buildCallbacks: ({ close, isAborted, send }) => {
        const state = {
          sessionEnded: false,
          sessionId: parsed.sessionId ?? crypto.randomUUID(),
        };
        return {
          onError: (error) => {
            sendAgentCoreEvent(send, state, {
              message: error instanceof Error ? getErrorMessage(error) : String(error),
              timestamp: Date.now(),
              type: "agent.error",
            });
            if (!state.sessionEnded) {
              const failedEnd: SessionEndEvent = {
                sessionId: state.sessionId,
                status: "failed",
                timestamp: Date.now(),
                type: "session.end",
              };
              sendAgentCoreEvent(send, state, failedEnd);
              state.sessionEnded = true;
            }
            close();
          },
          onEvent: createAgentCoreEventHandler(send, isAborted, close, state),
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
