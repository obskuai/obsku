import { afterEach, describe, expect, it } from "bun:test";
import { createApp } from "../../../src/server/index.js";
import type { ChatAgentEvent, ExecutableAgent } from "../../../src/server/routes/chat.js";

class MockExecutableAgent implements ExecutableAgent {
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
      data: { content: "Hello", phase: "executing" },
    } as ChatAgentEvent);
    await Promise.resolve();
    options?.onEvent?.({
      type: "stream.chunk",
      timestamp: Date.now(),
      data: { content: " world", phase: "executing" },
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
});
