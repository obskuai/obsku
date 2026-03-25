import type { AgentEvent, DefaultPublicPayload } from "@obsku/framework";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ChatRequest } from "../../shared/schemas.js";
import type { StudioProviderId } from "../provider-adapter.js";

export type ChatAgentEvent = DefaultPublicPayload<AgentEvent>;

interface SessionRuntimeSelection {
  provider: StudioProviderId;
  model: string;
}

export interface ExecutableAgentRunOptions {
  sessionId?: string;
  onEvent?: (event: ChatAgentEvent) => void;
}

export interface ExecutableAgent {
  run(input: string, options?: ExecutableAgentRunOptions): Promise<string>;
}

export interface ExecutableAgentRegistry {
  getExecutable(
    agentName: string
  ): ExecutableAgent | Promise<ExecutableAgent | undefined> | undefined;
}

export type ChatAgentRegistry =
  | ExecutableAgentRegistry
  | Map<string, ExecutableAgent>
  | Record<string, ExecutableAgent>;

export interface ChatRouteOptions {
  agentRegistry?: ChatAgentRegistry;
  getSessionExecutable?: (
    agentName: string,
    runtime: SessionRuntimeSelection
  ) => Promise<ExecutableAgent | undefined>;
}

async function resolveAgent(
  registry: ChatAgentRegistry | undefined,
  agentName: string
): Promise<ExecutableAgent | undefined> {
  if (!registry) {
    return undefined;
  }

  if (registry instanceof Map) {
    return registry.get(agentName);
  }

  if ("getExecutable" in registry && typeof registry.getExecutable === "function") {
    return await registry.getExecutable(agentName);
  }

  return (registry as Record<string, ExecutableAgent>)[agentName];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getTextChunk(event: ChatAgentEvent): string | undefined {
  if (event.type !== "stream.chunk") {
    return undefined;
  }

  return typeof event.data.content === "string" ? event.data.content : undefined;
}

function stripThinkingBlocks(text: string): string {
  let visible = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, "");
  const openIndex = visible.lastIndexOf("<thinking");

  if (openIndex !== -1) {
    visible = visible.slice(0, openIndex);
  }

  return visible.trimStart();
}

function getRuntimeSelection(event: ChatAgentEvent): SessionRuntimeSelection | undefined {
  const data = event.data as Record<string, unknown>;
  const runtimeProvider = data.runtimeProvider;
  const runtimeModel = data.runtimeModel;

  if (typeof runtimeProvider !== "string" || typeof runtimeModel !== "string") {
    return undefined;
  }

  return {
    provider: runtimeProvider as StudioProviderId,
    model: runtimeModel,
  };
}

function matchesRuntimeSelection(
  current: SessionRuntimeSelection,
  next: SessionRuntimeSelection
): boolean {
  return current.provider === next.provider && current.model === next.model;
}

export function createChatRoute(options: ChatRouteOptions = {}): Hono {
  const app = new Hono();
  const sessionRuntimeSelections = new Map<string, SessionRuntimeSelection>();

  app.post("/chat", async (c) => {
    let payload: unknown;

    try {
      payload = await c.req.json();
    } catch {
      throw new HTTPException(400, { message: "Invalid JSON body" });
    }

    const parsed = ChatRequest.safeParse(payload);

    if (!parsed.success) {
      throw new HTTPException(400, {
        message: JSON.stringify(parsed.error.issues),
      });
    }

    const { agentName, message } = parsed.data;
    const sessionId = parsed.data.sessionId ?? crypto.randomUUID();
    const requestedRuntime =
      parsed.data.provider && parsed.data.model
        ? {
            provider: parsed.data.provider,
            model: parsed.data.model,
          }
        : undefined;
    const lockedRuntime = sessionRuntimeSelections.get(sessionId);

    if (
      requestedRuntime &&
      lockedRuntime &&
      !matchesRuntimeSelection(lockedRuntime, requestedRuntime)
    ) {
      throw new HTTPException(400, {
        message: "provider/model locked for this session",
      });
    }

    const agent = requestedRuntime
      ? ((await options.getSessionExecutable?.(agentName, requestedRuntime)) ??
        (await resolveAgent(options.agentRegistry, agentName)))
      : await resolveAgent(options.agentRegistry, agentName);

    if (!agent) {
      throw new HTTPException(404, {
        message: `Unknown agent: ${agentName}`,
      });
    }

    if (requestedRuntime) {
      sessionRuntimeSelections.set(sessionId, requestedRuntime);
    }

    const encoder = new TextEncoder();
    let closed = false;
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let rawText = "";
    let visibleText = "";

    const cleanup = (): void => {
      if (closed) {
        return;
      }

      closed = true;

      try {
        controller?.close();
      } catch {}
    };

    const enqueue = (event: string, data: Record<string, unknown>): void => {
      if (closed) {
        return;
      }

      try {
        controller?.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      } catch {
        cleanup();
      }
    };

    const readable = new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController;
        enqueue("session", { agentName, sessionId });

        void (async () => {
          try {
            const result = await agent.run(message, {
              sessionId,
              onEvent: (event) => {
                const runtimeSelection = getRuntimeSelection(event);
                if (runtimeSelection && !sessionRuntimeSelections.has(sessionId)) {
                  sessionRuntimeSelections.set(sessionId, runtimeSelection);
                }

                const chunk = getTextChunk(event);
                if (!chunk) {
                  return;
                }

                rawText += chunk;
                const nextVisibleText = stripThinkingBlocks(rawText);

                if (nextVisibleText !== visibleText) {
                  visibleText = nextVisibleText;
                  enqueue("message", {
                    sessionId,
                    text: visibleText,
                  });
                }
              },
            });

            const nextVisibleText = stripThinkingBlocks(result);
            if (nextVisibleText !== visibleText) {
              visibleText = nextVisibleText;
              enqueue("message", {
                sessionId,
                text: visibleText,
              });
            }

            enqueue("done", {
              sessionId,
              text: visibleText,
            });
          } catch (error) {
            enqueue("error", {
              sessionId,
              message: getErrorMessage(error),
            });
          } finally {
            cleanup();
          }
        })();
      },
      cancel() {
        cleanup();
      },
    });

    c.req.raw.signal.addEventListener("abort", cleanup, { once: true });

    return new Response(readable, {
      headers: {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
      },
    });
  });

  return app;
}
