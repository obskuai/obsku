import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
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

    return streamSSE(c, async (stream) => {
      let isClosed = false;
      let resolveClosed!: () => void;

      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });

      const cleanup = (): void => {
        if (isClosed) return;
        isClosed = true;
        clearInterval(heartbeat);
        unsubscribe();
        c.req.raw.signal.removeEventListener("abort", handleAbort);
        resolveClosed();
      };

      const sendEvent = async (event: EventDisplayInfo): Promise<void> => {
        if (sessionId && event.sessionId !== sessionId) {
          return;
        }

        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
      };

      const handleAbort = (): void => {
        cleanup();
      };

      const unsubscribe = bridge.subscribe((event) => {
        void sendEvent(event).catch(() => {
          cleanup();
        });
      });

      const heartbeat = setInterval(() => {
        void stream.write(": heartbeat\n\n").catch(() => {
          cleanup();
        });
      }, heartbeatIntervalMs);

      stream.onAbort(() => {
        cleanup();
      });

      c.req.raw.signal.addEventListener("abort", handleAbort, { once: true });

      try {
        await closed;
      } finally {
        cleanup();
      }
    });
  });

  return app;
}
