import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { Registry } from "../scanner/registry.js";
import { eventBridge as defaultEventBridge } from "./event-bridge.js";
import type { EventRecorder } from "./executable-agent-registry.js";
import { RegistryBackedExecutableAgentRegistry } from "./executable-agent-registry.js";
import type { RegistryReader } from "./routes/agents.js";
import { createAgentsRoute } from "./routes/agents.js";
import { type ChatAgentRegistry, createChatRoute, type ExecutableAgent } from "./routes/chat.js";
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

function isEventRecorder(value: SessionEventStore): value is SessionEventStore & EventRecorder {
  return typeof (value as { recordEvent?: unknown }).recordEvent === "function";
}

function getFrontendDistDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDir, "..", "..", "dist", "frontend"),
    resolve(moduleDir, "..", "frontend", "dist", "frontend"),
    resolve(moduleDir, "frontend"),
    resolve(moduleDir, "..", "frontend"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0]!;
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
  const sharedSessionsBridge = sessionsEventBridge ?? defaultEventBridge;
  const sharedEventRecorder = isEventRecorder(sharedSessionsBridge)
    ? sharedSessionsBridge
    : undefined;
  let sharedRegistry = registry;
  let resolvedChatRegistry = agentRegistry;

  const getSharedRegistry = (): RegistryReader => {
    sharedRegistry ??= new Registry({ rootDir });
    return sharedRegistry;
  };

  const getResolvedChatRegistry = (): ChatAgentRegistry | undefined => {
    if (resolvedChatRegistry) {
      return resolvedChatRegistry;
    }

    const currentRegistry = getSharedRegistry();
    if (!(currentRegistry instanceof Registry)) {
      return undefined;
    }

    resolvedChatRegistry = new RegistryBackedExecutableAgentRegistry(
      currentRegistry,
      sharedEventRecorder
    );
    return resolvedChatRegistry;
  };
  const frontendDistDir = getFrontendDistDir();
  const frontendIndexHtml = readFileSync(resolve(frontendDistDir, "index.html"), "utf8");

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
      registry: {
        getAgent(name: string) {
          return getSharedRegistry().getAgent(name);
        },
        getAgents() {
          return getSharedRegistry().getAgents();
        },
        getGraph(id: string) {
          return getSharedRegistry().getGraph(id);
        },
        getGraphs() {
          return getSharedRegistry().getGraphs();
        },
      },
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
      eventBridge: sharedSessionsBridge,
    })
  );

  app.route(
    "/api",
    createChatRoute({
      agentRegistry: {
        getExecutable(agentName: string) {
          const currentRegistry = getResolvedChatRegistry();
          if (!currentRegistry) {
            return undefined;
          }

          if (currentRegistry instanceof Map) {
            return currentRegistry.get(agentName);
          }

          if (
            "getExecutable" in currentRegistry &&
            typeof currentRegistry.getExecutable === "function"
          ) {
            return currentRegistry.getExecutable(agentName);
          }
          return (currentRegistry as Record<string, ExecutableAgent>)[agentName];
        },
      },
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

  app.use("/*", serveStatic({ root: frontendDistDir }));
  app.get("/", (c) => c.html(frontendIndexHtml));
  app.get("/*", (c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.notFound();
    }

    return c.html(frontendIndexHtml);
  });

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
