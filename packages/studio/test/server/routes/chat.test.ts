import { afterEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createApp } from "../../../src/server/index.js";
import type { StudioProviderId } from "../../../src/server/provider-adapter.js";
import {
  type ChatAgentEvent,
  createChatRoute,
  type ExecutableAgent,
} from "../../../src/server/routes/chat.js";

class MockExecutableAgent implements ExecutableAgent {
  constructor(
    private readonly runtime?: {
      provider: StudioProviderId;
      model: string;
    }
  ) {}

  calls: Array<{ input: string; sessionId?: string }> = [];

  async run(
    input: string,
    options?: { onEvent?: (event: ChatAgentEvent) => void; sessionId?: string }
  ): Promise<string> {
    this.calls.push({
      input,
      sessionId: options?.sessionId,
    });

    options?.onEvent?.({
      type: "stream.chunk",
      timestamp: Date.now(),
      data: {
        content: "Hello",
        phase: "executing",
        runtimeModel: this.runtime?.model,
        runtimeProvider: this.runtime?.provider,
      },
    } as ChatAgentEvent);
    await Promise.resolve();
    options?.onEvent?.({
      type: "stream.chunk",
      timestamp: Date.now(),
      data: {
        content: " world",
        phase: "executing",
        runtimeModel: this.runtime?.model,
        runtimeProvider: this.runtime?.provider,
      },
    } as ChatAgentEvent);

    return "Hello world";
  }
}

async function readStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Missing response body");
  }

  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    output += decoder.decode(value, { stream: true });

    if (output.includes("event: done")) {
      break;
    }
  }

  await reader.cancel().catch(() => undefined);
  return output;
}

const openResponses = new Set<Response>();

afterEach(async () => {
  for (const response of openResponses) {
    await response.body?.cancel().catch(() => undefined);
  }

  openResponses.clear();
});

function createChatApp(options: Parameters<typeof createChatRoute>[0]): Hono {
  const app = new Hono();
  app.route("/api", createChatRoute(options));
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json(
        {
          error: err.message,
          code: `HTTP_${err.status}`,
        },
        err.status
      );
    }

    throw err;
  });
  return app;
}

describe("Chat API route", () => {
  it("rejects invalid chat payloads", async () => {
    const app = createApp({ enableLogging: false });

    const response = await app.request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "HTTP_400",
      error: expect.any(String),
    });
  });

  it("returns 404 when the requested agent is not registered", async () => {
    const app = createApp({
      enableLogging: false,
      agentRegistry: {},
    });

    const response = await app.request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName: "missing", message: "Hello" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "HTTP_404",
      error: "Unknown agent: missing",
    });
  });

  it("streams cumulative assistant text over SSE", async () => {
    const agent = new MockExecutableAgent();
    const app = createApp({
      enableLogging: false,
      agentRegistry: {
        "code-reviewer": agent,
      },
    });

    const response = await app.request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentName: "code-reviewer",
        message: "Review this",
        sessionId: "session-123",
      }),
    });
    openResponses.add(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const output = await readStream(response);

    expect(agent.calls).toEqual([{ input: "Review this", sessionId: "session-123" }]);
    expect(output).toContain("event: session");
    expect(output).toContain('"sessionId":"session-123"');
    expect(output).toContain("event: message");
    expect(output).toContain('"text":"Hello"');
    expect(output).toContain('"text":"Hello world"');
    expect(output).toContain("event: done");
  });

  it("uses an explicit provider/model adapter for a new session", async () => {
    const defaultAgent = new MockExecutableAgent({
      provider: "bedrock",
      model: "amazon.nova-lite-v1:0",
    });
    const explicitAgent = new MockExecutableAgent({ provider: "openai", model: "gpt-4o-mini" });
    const explicitSelections: Array<{
      agentName: string;
      provider: StudioProviderId;
      model: string;
    }> = [];
    const app = createChatApp({
      agentRegistry: { reviewer: defaultAgent },
      getSessionExecutable: async (agentName, runtime) => {
        explicitSelections.push({ agentName, provider: runtime.provider, model: runtime.model });
        return explicitAgent;
      },
    });

    const response = await app.request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentName: "reviewer",
        message: "Review this",
        provider: "openai",
        model: "gpt-4o-mini",
      }),
    });
    openResponses.add(response);

    expect(response.status).toBe(200);
    const output = await readStream(response);

    expect(explicitSelections).toEqual([
      { agentName: "reviewer", provider: "openai", model: "gpt-4o-mini" },
    ]);
    expect(defaultAgent.calls).toEqual([]);
    expect(explicitAgent.calls).toHaveLength(1);
    expect(output).toContain("event: done");
  });

  it("uses the default registry executable when provider/model are omitted", async () => {
    const defaultAgent = new MockExecutableAgent({
      provider: "bedrock",
      model: "amazon.nova-lite-v1:0",
    });
    let explicitCallCount = 0;
    const app = createChatApp({
      agentRegistry: { reviewer: defaultAgent },
      getSessionExecutable: async () => {
        explicitCallCount += 1;
        return undefined;
      },
    });

    const response = await app.request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentName: "reviewer",
        message: "Review this",
        sessionId: "session-default",
      }),
    });
    openResponses.add(response);

    expect(response.status).toBe(200);
    await readStream(response);

    expect(explicitCallCount).toBe(0);
    expect(defaultAgent.calls).toEqual([{ input: "Review this", sessionId: "session-default" }]);
  });

  it("rejects provider/model changes after the first message in a session", async () => {
    const defaultAgent = new MockExecutableAgent({
      provider: "bedrock",
      model: "amazon.nova-lite-v1:0",
    });
    const app = createChatApp({
      agentRegistry: { reviewer: defaultAgent },
      getSessionExecutable: async () =>
        new MockExecutableAgent({ provider: "openai", model: "gpt-4o-mini" }),
    });

    const firstResponse = await app.request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentName: "reviewer",
        message: "First turn",
        sessionId: "session-locked",
      }),
    });
    openResponses.add(firstResponse);

    expect(firstResponse.status).toBe(200);
    await readStream(firstResponse);

    const secondResponse = await app.request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentName: "reviewer",
        message: "Second turn",
        sessionId: "session-locked",
        provider: "openai",
        model: "gpt-4o-mini",
      }),
    });

    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual({
      code: "HTTP_400",
      error: "provider/model locked for this session",
    });
  });
});
