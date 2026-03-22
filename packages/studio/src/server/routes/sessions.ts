import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { SessionDetailResponse, SessionListResponse } from "../../shared/schemas.js";
import { type EventBridge, eventBridge } from "../event-bridge.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface SessionEventStore {
  getSession(sessionId: string): ReturnType<EventBridge["getSession"]>;
  getSessions(): ReturnType<EventBridge["getSessions"]>;
  queryEvents(
    sessionId: string,
    filters?: Parameters<EventBridge["queryEvents"]>[1]
  ): ReturnType<EventBridge["queryEvents"]>;
}

export interface SessionsRouteOptions {
  eventBridge?: SessionEventStore;
}

export function createSessionsRoute(options: SessionsRouteOptions = {}): Hono {
  const app = new Hono();
  const bridge = options.eventBridge ?? eventBridge;

  app.get("/sessions", (c) => {
    const page = parsePositiveInt(c.req.query("page")) ?? DEFAULT_PAGE;
    const limit = clampLimit(parsePositiveInt(c.req.query("limit")) ?? DEFAULT_LIMIT);
    const sessions = bridge.getSessions();
    const total = sessions.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const offset = (page - 1) * limit;

    const response = SessionListResponse.parse({
      success: true,
      sessions: sessions.slice(offset, offset + limit),
      page,
      limit,
      total,
      totalPages,
    });

    return c.json(response);
  });

  app.get("/sessions/:id", (c) => {
    const session = bridge.getSession(c.req.param("id"));
    if (!session) {
      throw new HTTPException(404, { message: "Session not found" });
    }

    const response = SessionDetailResponse.parse({
      success: true,
      session,
      events: bridge.queryEvents(session.id).events,
    });

    return c.json(response);
  });

  return app;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function clampLimit(value: number): number {
  return Math.min(Math.max(value, 1), MAX_LIMIT);
}
