import type { AgentEvent, DefaultPublicPayload } from "@obsku/framework";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { ChatRequest } from "../../shared/schemas.js";

export type ChatAgentEvent = DefaultPublicPayload<AgentEvent>;

export interface ExecutableAgentRunOptions {
  sessionId?: string;
  onEvent?: (event: ChatAgentEvent) => void;
}

export interface ExecutableAgent {
  run(input: string, options?: ExecutableAgentRunOptions): Promise<string>;
}

export interface ExecutableAgentRegistry {
  getExecutable(agentName: string): ExecutableAgent | undefined;
}

export type ChatAgentRegistry =
  | ExecutableAgentRegistry
  | Map<string, ExecutableAgent>
  | Record<string, ExecutableAgent>;

export interface ChatRouteOptions {
  agentRegistry?: ChatAgentRegistry;
}

function resolveAgent(
  registry: ChatAgentRegistry | undefined,
  agentName: string
): ExecutableAgent | undefined {
  if (!registry) {
    return undefined;
  }

  if (registry instanceof Map) {
    return registry.get(agentName);
  }

  if ("getExecutable" in registry && typeof registry.getExecutable === "function") {
    return registry.getExecutable(agentName);
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

export function createChatRoute(options: ChatRouteOptions = {}): Hono {
  const app = new Hono();

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
    const agent = resolveAgent(options.agentRegistry, agentName);

    if (!agent) {
      throw new HTTPException(404, {
        message: `Unknown agent: ${agentName}`,
      });
    }

    const sessionId = parsed.data.sessionId ?? crypto.randomUUID();

    return streamSSE(c, async (stream) => {
      let cumulativeText = "";
      let writeChain = Promise.resolve();
      let closed = false;

      const close = (): void => {
        closed = true;
      };

      const enqueue = (event: string, data: Record<string, unknown>): void => {
        writeChain = writeChain.then(async () => {
          if (closed) {
            return;
          }

          await stream.writeSSE({
            event,
            data: JSON.stringify(data),
          });
        });
      };

      stream.onAbort(close);
      c.req.raw.signal.addEventListener("abort", close, { once: true });

      enqueue("session", { agentName, sessionId });

      try {
        const result = await agent.run(message, {
          sessionId,
          onEvent: (event) => {
            const chunk = getTextChunk(event);
            if (!chunk) {
              return;
            }

            cumulativeText += chunk;
            enqueue("message", {
              sessionId,
              text: cumulativeText,
            });
          },
        });

        if (result !== cumulativeText) {
          cumulativeText = result;
          enqueue("message", {
            sessionId,
            text: cumulativeText,
          });
        }

        enqueue("done", {
          sessionId,
          text: cumulativeText,
        });
      } catch (error) {
        enqueue("error", {
          sessionId,
          message: getErrorMessage(error),
        });
      }

      await writeChain;
    });
  });

  return app;
}
