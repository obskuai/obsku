import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { ChatModelRunResult } from "@assistant-ui/react";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { fireEvent, render } from "@testing-library/react";

import Chat, {
  createChatModelAdapter,
  type ParsedSseEvent,
  parseSseEventBlock,
} from "../../src/frontend/pages/Chat";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
});

describe("Chat page", () => {
  it("renders the agent selector", () => {
    const view = render(<Chat />);

    const select = view.getByLabelText("Agent");
    expect(select).toBeTruthy();
    expect(view.getByRole("option", { name: "Customer Support Bot" })).toBeTruthy();
    expect(view.getByRole("option", { name: "Code Reviewer" })).toBeTruthy();

    fireEvent.change(select, { target: { value: "code-reviewer" } });

    expect((select as HTMLSelectElement).value).toBe("code-reviewer");
  });
});

describe("chat adapter helpers", () => {
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

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
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
    }) as typeof fetch;

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
