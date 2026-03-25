import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof document === "undefined") {
  try {
    GlobalRegistrator.register();
  } catch {}
}

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SessionDetail } from "../../src/frontend/pages/SessionDetail";
import { SessionList } from "../../src/frontend/pages/SessionList";

if (typeof window !== "undefined") {
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.hasPointerCapture = function () {
    return false;
  };
  window.HTMLElement.prototype.releasePointerCapture = function () {};
}

afterEach(() => {
  cleanup();
  globalThis.fetch = savedFetch;
});

afterAll(() => {
  globalThis.fetch = savedFetch;
});

const mockSessionData = {
  success: true as const,
  sessions: [
    {
      id: "sess_1",
      title: "How to use React?",
      createdAt: 1700000000000,
      status: "completed",
      messageCount: 5,
    },
    {
      id: "sess_2",
      title: "Debug API issue",
      createdAt: 1700003600000,
      status: "active",
      messageCount: 3,
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const mockSessionDetail = {
  success: true as const,
  session: {
    createdAt: 1700000000000,
    id: "sess_1",
    title: "How to use React?",
    status: "completed",
    messageCount: 5,
  },
  events: [
    {
      type: "session.start",
      category: "session",
      timestamp: 1700000000000,
      data: {},
      severity: "info",
    },
    {
      type: "agent.thinking",
      category: "agent",
      timestamp: 1700000001000,
      agent: "support-agent",
      data: { content: "Let me think..." },
      severity: "info",
    },
  ],
};

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 200));
}

const savedFetch = globalThis.fetch;

function mockSessionAndEventFetches(sessionData: unknown) {
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/events")) {
        return new Response("", {
          headers: { "Content-Type": "text/event-stream" },
          status: 200,
        });
      }
      return new Response(JSON.stringify(sessionData), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    },
    { preconnect: savedFetch.preconnect }
  ) satisfies typeof fetch;
}

describe("SessionList", () => {
  it("renders the list of sessions from API", async () => {
    const originalFetch = globalThis.fetch;
    mockSessionAndEventFetches(mockSessionData);

    let getByText: ReturnType<typeof render>["getByText"];
    await act(async () => {
      const result = render(
        <MemoryRouter>
          <Routes>
            <Route path="*" element={<SessionList />} />
          </Routes>
        </MemoryRouter>
      );
      getByText = result.getByText;
      await flushPromises();
    });

    expect(getByText!("Sessions")).toBeTruthy();
    expect(getByText!("How to use React?")).toBeTruthy();
    expect(getByText!("Debug API issue")).toBeTruthy();
    expect(getByText!("completed")).toBeTruthy();
    expect(getByText!("active")).toBeTruthy();

    globalThis.fetch = originalFetch;
  });

  it("renders loading state while fetching", () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = Object.assign(async () => new Promise<Response>(() => {}), {
      preconnect: originalFetch.preconnect,
    }) satisfies typeof fetch;

    const { getByText } = render(
      <MemoryRouter>
        <Routes>
          <Route path="*" element={<SessionList />} />
        </Routes>
      </MemoryRouter>
    );

    expect(getByText("Loading sessions...")).toBeTruthy();

    globalThis.fetch = originalFetch;
  });
});

describe("SessionDetail", () => {
  it("renders session metadata from API", async () => {
    const originalFetch = globalThis.fetch;
    mockSessionAndEventFetches(mockSessionDetail);

    let getByText: ReturnType<typeof render>["getByText"];
    let queryAllByText: ReturnType<typeof render>["queryAllByText"];
    await act(async () => {
      const result = render(
        <MemoryRouter initialEntries={["/sessions/sess_1"]}>
          <Routes>
            <Route path="/sessions/:id" element={<SessionDetail />} />
          </Routes>
        </MemoryRouter>
      );
      getByText = result.getByText;
      queryAllByText = result.queryAllByText;
      await flushPromises();
    });

    expect(queryAllByText!(/Session sess/).length).toBeGreaterThan(0);
    expect(getByText!("How to use React?")).toBeTruthy();

    globalThis.fetch = originalFetch;
  });

  it("renders event timeline", async () => {
    const originalFetch = globalThis.fetch;
    mockSessionAndEventFetches(mockSessionDetail);

    let getByText: ReturnType<typeof render>["getByText"];
    let queryAllByText: ReturnType<typeof render>["queryAllByText"];
    await act(async () => {
      const result = render(
        <MemoryRouter initialEntries={["/sessions/sess_1"]}>
          <Routes>
            <Route path="/sessions/:id" element={<SessionDetail />} />
          </Routes>
        </MemoryRouter>
      );
      getByText = result.getByText;
      queryAllByText = result.queryAllByText;
      await flushPromises();
    });

    expect(getByText!("Event Timeline")).toBeTruthy();
    expect(queryAllByText!(/\d+ Events/).length).toBeGreaterThan(0);

    globalThis.fetch = originalFetch;
  });

  it("renders error state when session not found", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = Object.assign(
      async () =>
        new Response(JSON.stringify({ error: "Not Found", code: "ROUTE_NOT_FOUND" }), {
          headers: { "Content-Type": "application/json" },
          status: 404,
        }),
      { preconnect: originalFetch.preconnect }
    ) satisfies typeof fetch;

    let queryAllByText: ReturnType<typeof render>["queryAllByText"];
    await act(async () => {
      const result = render(
        <MemoryRouter initialEntries={["/sessions/nonexistent"]}>
          <Routes>
            <Route path="/sessions/:id" element={<SessionDetail />} />
          </Routes>
        </MemoryRouter>
      );
      queryAllByText = result.queryAllByText;
      await flushPromises();
    });

    expect(queryAllByText!(/not found/i).length).toBeGreaterThan(0);

    globalThis.fetch = originalFetch;
  });
});
