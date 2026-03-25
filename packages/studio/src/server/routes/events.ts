import { Hono } from "hono";
import type { EventDisplayInfo } from "../../shared/types.js";
import { type EventBroadcastHandler, eventBridge } from "../event-bridge.js";

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export interface EventBridgeSubscriber {
  subscribe(handler: EventBroadcastHandler): () => void;
}

export interface EventsRouteOptions {
  eventBridge?: EventBridgeSubscriber;
  heartbeatIntervalMs?: number;
}

export function createEventsRoute(options: EventsRouteOptions = {}): Hono {
  const app = new Hono();
  const bridge = options.eventBridge ?? eventBridge;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;

  app.get("/", (c) => {
    const sessionId = c.req.query("sessionId");
    const encoder = new TextEncoder();
    let closed = false;
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | undefined;

    const cleanup = (): void => {
      if (closed) {
        return;
      }

      closed = true;

      if (heartbeat !== undefined) {
        clearInterval(heartbeat);
      }

      unsubscribe?.();

      try {
        controller?.close();
      } catch {}
    };

    const enqueue = (chunk: string): void => {
      if (closed) {
        return;
      }

      try {
        controller?.enqueue(encoder.encode(chunk));
      } catch {
        cleanup();
      }
    };

    const readable = new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController;
        unsubscribe = bridge.subscribe((event: EventDisplayInfo) => {
          if (sessionId && event.sessionId !== sessionId) {
            return;
          }

          enqueue(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        });

        heartbeat = setInterval(() => {
          enqueue(": heartbeat\n\n");
        }, heartbeatIntervalMs);
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
