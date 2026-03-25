import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (typeof document === "undefined") {
  try {
    GlobalRegistrator.register();
  } catch {}
}

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { ChatModelRunResult } from "@assistant-ui/react";
import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import Chat, {
  createChatModelAdapter,
  type ParsedSseEvent,
  parseSseEventBlock,
} from "../../src/frontend/pages/Chat";

beforeAll(() => {
  if (typeof window !== "undefined") {
    window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  }
});

describe("Chat page", () => {
  const savedChatFetch = globalThis.fetch;
  afterAll(() => {
    globalThis.fetch = savedChatFetch;
  });

  it("renders the agent selector with loaded agents", async () => {
    const originalFetch = globalThis.fetch;

    const mockFetch = Object.assign(
      async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/providers')) {
          return new Response(
            JSON.stringify({
              success: true,
              providers: [
                { id: 'bedrock', name: 'Amazon Bedrock', detected: true, defaultModel: 'amazon.nova-lite-v1:0', models: ['amazon.nova-lite-v1:0'] },
              ],
              active: { id: 'bedrock', source: 'fallback' },
            }),
            { headers: { 'Content-Type': 'application/json' }, status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            success: true,
            agents: [
              { name: "Customer Support Bot", description: "Help agent", toolCount: 0 },
              { name: "Code Reviewer", description: "Review agent", toolCount: 0 },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        );
      },
      { preconnect: originalFetch.preconnect }
    ) satisfies typeof fetch;

    globalThis.fetch = mockFetch;

    const view = render(
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const select = view.getByLabelText("Agent");
    expect(select).toBeTruthy();
    expect(view.getByRole("option", { name: "Customer Support Bot" })).toBeTruthy();
    expect(view.getByRole("option", { name: "Code Reviewer" })).toBeTruthy();

    fireEvent.change(select, { target: { value: "Code Reviewer" } });

    expect((select as HTMLSelectElement).value).toBe("Code Reviewer");

    globalThis.fetch = originalFetch;
  });
});

describe("chat adapter helpers", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses SSE event blocks", () => {
    const parsed = parseSseEventBlock('event: message\ndata: {"text":"Hello"}');

    expect(parsed).toEqual({
      event: "message",
      data: '{"text":"Hello"}',
    } satisfies ParsedSseEvent);
  });

  it("posts to the chat API and yields cumulative text", async () => {
    const fetchCalls: Array<RequestInit | undefined> = [];
    const sessionIds: string[] = [];

    const mockFetch = Object.assign(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push(init);

        return new Response(
          [
            'event: session\ndata: {"sessionId":"session-1"}',
            'event: message\ndata: {"sessionId":"session-1","text":"Hello"}',
            'event: message\ndata: {"sessionId":"session-1","text":"Hello world"}',
            'event: done\ndata: {"sessionId":"session-1","text":"Hello world"}',
            "",
          ].join("\n\n"),
          {
            headers: { "Content-Type": "text/event-stream" },
            status: 200,
          }
        );
      },
      { preconnect: originalFetch.preconnect }
    ) satisfies typeof fetch;

    globalThis.fetch = mockFetch;

    const adapter = createChatModelAdapter({
      agentName: "code-reviewer",
      sessionId: "session-1",
      onSessionId: (sessionId) => sessionIds.push(sessionId),
    });

    const messages = [
      {
        id: "msg-1",
        role: "user",
        content: [{ type: "text", text: "Review this diff" }],
        createdAt: new Date(),
        metadata: { custom: {} },
        attachments: [],
      },
    ] as const;

    const results: string[] = [];

    const streamingAdapter = adapter as {
      run(options: Parameters<typeof adapter.run>[0]): AsyncGenerator<ChatModelRunResult, void>;
    };

    const run = streamingAdapter.run({
      abortSignal: new AbortController().signal,
      config: {} as never,
      context: {} as never,
      messages,
      runConfig: {},
      unstable_getMessage: () => messages[0] as never,
    });

    for await (const update of run) {
      results.push(update.content?.[0]?.type === "text" ? update.content[0].text : "");
    }

    expect(fetchCalls).toHaveLength(1);
    expect(JSON.parse(String(fetchCalls[0]?.body))).toEqual({
      agentName: "code-reviewer",
      message: "Review this diff",
      sessionId: "session-1",
    });
    expect(sessionIds).toEqual(["session-1", "session-1", "session-1", "session-1"]);
    expect(results).toEqual(["Hello", "Hello world"]);
  });
});
