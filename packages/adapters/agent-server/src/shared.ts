import type { AgentEvent, ConversationMessage, LLMProvider } from "@obsku/framework";
import { DEFAULTS } from "@obsku/framework";
import { HTTP_STATUS, SSE_CACHE_CONTROL, SSE_CONNECTION, SSE_CONTENT_TYPE } from "./constants";

export interface ServeOptions {
  description?: string;
  logger?: { error(msg: string): void };
  port?: number;
  protocol?: "a2a" | "agentcore";
  providerFactory?: (model: string) => LLMProvider | Promise<LLMProvider>;
  skills?: Array<string>;
  streaming?: boolean;
}

export interface AgentLike {
  name: string;
  run: (
    input: string,
    provider: LLMProvider,
    options?: {
      messages?: Array<ConversationMessage>;
      onEvent?: (event: AgentEvent) => void;
      sessionId?: string;
    }
  ) => Promise<string>;
}

export interface SSEMessageOptions {
  data: unknown;
  event?: string;
}

export function createHealthHandler(): Response {
  return Response.json({
    status: "Healthy",
    time_of_last_update: Math.floor(Date.now() / DEFAULTS.msPerSecond),
  });
}

export function createErrorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export function createWriteErr(logger?: { error(msg: string): void }) {
  return (msg: string) => {
    if (logger) {
      logger.error(msg);
    } else {
      process.stderr.write(msg + "\n");
    }
  };
}

export function createBunServer(
  port: number,
  hostname: string,
  writeErr: (msg: string) => void,
  handler: (req: Request) => Response | Promise<Response>
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    error(err) {
      writeErr(`[Server] unhandled error: ${String(err)}`);
      return new Response("Internal Server Error", { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
    },
    fetch: handler,
    hostname,
    idleTimeout: 255,
    port,
  });
}

export function formatSSEMessage(options: SSEMessageOptions): string {
  const lines: Array<string> = [];
  if (options.event) {
    lines.push(`event: ${options.event}`);
  }

  const payload = typeof options.data === "string" ? options.data : JSON.stringify(options.data);
  for (const line of payload.split("\n")) {
    lines.push(`data: ${line}`);
  }

  return `${lines.join("\n")}\n\n`;
}

export function createSSEStream(
  signal: AbortSignal,
  handler: (
    send: (data: string) => void,
    isAborted: () => boolean,
    close: () => void
  ) => Promise<void>,
  writeErr: (msg: string) => void
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let aborted = false;
      let closed = false;

      const send = (data: string) => {
        if (aborted || closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(data));
        } catch (error: unknown) {
          aborted = true;
          const msg = `[SSE] enqueue failed: ${String(error)}\n`;
          writeErr(msg);
        }
      };

      const onAbort = () => {
        aborted = true;
      };
      signal.addEventListener("abort", onAbort);

      const close = () => {
        if (aborted || closed) {
          return;
        }
        closed = true;
        try {
          controller.close();
        } catch (error: unknown) {
          writeErr(`[SSE] controller.close failed in close(): ${String(error)}\n`);
        }
      };

      try {
        await handler(send, () => aborted || closed, close);
      } finally {
        signal.removeEventListener("abort", onAbort);
        if (!aborted && !closed) {
          try {
            controller.close();
          } catch (error: unknown) {
            writeErr(`[SSE] controller.close failed in finally: ${String(error)}\n`);
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": SSE_CACHE_CONTROL,
      Connection: SSE_CONNECTION,
      "Content-Type": SSE_CONTENT_TYPE,
    },
  });
}
