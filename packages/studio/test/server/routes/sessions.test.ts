import { describe, expect, it } from "bun:test";
import { createApp } from "../../../src/server/index.js";
import type { SessionEventStore } from "../../../src/server/routes/sessions.js";
import type { EventDisplayInfo } from "../../../src/shared/types.js";

class MockSessionEventBridge implements SessionEventStore {
  private sessions = [
    {
      id: "session-3",
      title: "Third",
      createdAt: 300,
      updatedAt: 350,
      status: "completed" as const,
      messageCount: 3,
    },
    {
      id: "session-2",
      title: "Second",
      createdAt: 200,
      updatedAt: 250,
      status: "active" as const,
      messageCount: 2,
    },
    {
      id: "session-1",
      title: "First",
      createdAt: 100,
      updatedAt: 150,
      status: "failed" as const,
      messageCount: 1,
    },
  ];

  getSessions() {
    return this.sessions;
  }

  getSession(sessionId: string) {
    return this.sessions.find((session) => session.id === sessionId);
  }

  queryEvents(sessionId: string) {
    const events: EventDisplayInfo[] = [
      {
        type: "session.start",
        category: "session",
        timestamp: 101,
        severity: "info",
        sessionId,
        data: { input: "hello" },
      },
      {
        type: "agent.complete",
        category: "agent",
        timestamp: 102,
        severity: "success",
        sessionId,
        data: { output: "done" },
      },
    ];

    return {
      events,
      total: events.length,
      offset: 0,
      limit: events.length,
    };
  }
}

describe("Session API", () => {
  const app = createApp({
    enableLogging: false,
    sessionsEventBridge: new MockSessionEventBridge(),
  });

  it("GET /api/sessions returns paginated sessions", async () => {
    const response = await app.request("http://localhost/api/sessions?page=2&limit=1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      sessions: [
        {
          id: "session-2",
          title: "Second",
          createdAt: 200,
          updatedAt: 250,
          status: "active",
          messageCount: 2,
        },
      ],
      page: 2,
      limit: 1,
      total: 3,
      totalPages: 3,
    });
  });

  it("GET /api/sessions/:id returns session detail with events", async () => {
    const response = await app.request("http://localhost/api/sessions/session-2");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      session: {
        id: "session-2",
        title: "Second",
        createdAt: 200,
        updatedAt: 250,
        status: "active",
        messageCount: 2,
      },
      events: [
        {
          type: "session.start",
          category: "session",
          timestamp: 101,
          severity: "info",
          sessionId: "session-2",
          data: { input: "hello" },
        },
        {
          type: "agent.complete",
          category: "agent",
          timestamp: 102,
          severity: "success",
          sessionId: "session-2",
          data: { output: "done" },
        },
      ],
    });
  });

  it("returns 404 for missing sessions", async () => {
    const response = await app.request("http://localhost/api/sessions/missing");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Session not found",
      code: "HTTP_404",
    });
  });
});
