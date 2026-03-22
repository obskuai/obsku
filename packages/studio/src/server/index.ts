import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import type { RegistryReader } from "./routes/agents.js";
import { createAgentsRoute } from "./routes/agents.js";
import { type ChatAgentRegistry, createChatRoute } from "./routes/chat.js";
import { createEventsRoute, type EventBridgeSubscriber } from "./routes/events.js";
import { createSessionsRoute, type SessionEventStore } from "./routes/sessions.js";

export const STUDIO_VERSION = "0.1.0";

export interface StudioAppOptions {
  port?: number;
  hostname?: string;
  enableLogging?: boolean;
  eventBridge?: EventBridgeSubscriber;
  eventsHeartbeatIntervalMs?: number;
  registry?: RegistryReader;
  sessionsEventBridge?: SessionEventStore;
  rootDir?: string;
  agentRegistry?: ChatAgentRegistry;
}

export interface StudioApp {
  app: Hono;
  port: number;
  hostname: string;
}

export function createApp(options: StudioAppOptions = {}): Hono {
  const {
    enableLogging = true,
    eventBridge,
    eventsHeartbeatIntervalMs,
    registry,
    rootDir,
    sessionsEventBridge,
    agentRegistry,
  } = options;

  const app = new Hono();

  if (enableLogging) {
    app.use(logger());
  }

  app.use(
    cors({
      origin: (origin) => {
        if (!origin) return "*";
        if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
          return origin;
        }
        return null;
      },
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    })
  );

  app.get("/api/health", (c) => {
    return c.json({
      status: "ok",
      version: STUDIO_VERSION,
    });
  });

  app.route(
    "/api",
    createAgentsRoute({
      registry,
      rootDir,
    })
  );

  app.route(
    "/api/events",
    createEventsRoute({
      eventBridge,
      heartbeatIntervalMs: eventsHeartbeatIntervalMs,
    })
  );

  app.route(
    "/api",
    createSessionsRoute({
      eventBridge: sessionsEventBridge,
    })
  );

  app.route(
    "/api",
    createChatRoute({
      agentRegistry,
    })
  );

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json(
        {
          error: "Not Found",
          code: "ROUTE_NOT_FOUND",
        },
        404
      );
    }
    return c.text("Not Found", 404);
  });

  app.get("/", serveStatic({ path: "./dist/frontend/index.html" }));
  app.use("/*", serveStatic({ root: "./dist/frontend" }));
  app.get("/*", serveStatic({ path: "./dist/frontend/index.html" }));

  app.onError((err, c) => {
    console.error("[Studio Server Error]", err);

    if (err instanceof HTTPException) {
      return c.json(
        {
          error: err.message,
          code: `HTTP_${err.status}`,
        },
        err.status
      );
    }

    return c.json(
      {
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
      },
      500
    );
  });

  return app;
}

export function createStudioApp(options: StudioAppOptions = {}): StudioApp {
  const port = options.port ?? Number(process.env.STUDIO_PORT ?? 3000);
  const hostname = options.hostname ?? process.env.STUDIO_HOST ?? "0.0.0.0";

  const app = createApp(options);

  return {
    app,
    port,
    hostname,
  };
}
