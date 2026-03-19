import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AgentEvent, ConversationMessage, LLMProvider } from "@obsku/framework";
import { type AgentLike, serve } from "../src/index";

const mockProvider: LLMProvider = {
  chat: async () => ({
    content: [{ text: "mock response", type: "text" }],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 5 },
  }),
  chatStream: async function* () {
    yield { content: "mock", type: "text_delta" };
    yield {
      stopReason: "end_turn",
      type: "message_end",
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  },
  contextWindowSize: 100_000,
};

const createMockAgent = (name = "test-agent"): AgentLike => ({
  name,
  run: async (
    input: string,
    _provider: LLMProvider,
    options?: { messages?: Array<ConversationMessage>; onEvent?: (event: AgentEvent) => void }
  ): Promise<string> => {
    if (options?.onEvent) {
      emitEvent(options.onEvent, {
        input,
        sessionId: "framework-session-1",
        timestamp: Date.now(),
        type: "session.start",
      });
      emitEvent(options.onEvent, {
        phase: "summarizing",
        timestamp: Date.now(),
        turn: 0,
        type: "turn.start",
      });
      emitEvent(options.onEvent, { timestamp: Date.now(), turn: 0, type: "stream.start" });
      emitEvent(options.onEvent, {
        content: "Hello ",
        phase: "summarizing",
        timestamp: Date.now(),
        type: "stream.chunk",
      });
      emitEvent(options.onEvent, {
        content: "world!",
        phase: "summarizing",
        timestamp: Date.now(),
        type: "stream.chunk",
      });
      emitEvent(options.onEvent, {
        summary: "Hello world!",
        timestamp: Date.now(),
        type: "agent.complete",
        usage: { llmCalls: 1, totalInputTokens: 10, totalOutputTokens: 5 },
      });
      emitEvent(options.onEvent, {
        status: "completed",
        timestamp: Date.now(),
        turn: 0,
        type: "turn.end",
      });
      emitEvent(options.onEvent, {
        output: "Hello world!",
        sessionId: "framework-session-1",
        status: "complete",
        timestamp: Date.now(),
        turns: 1,
        type: "session.end",
      });
    }
    return "Hello world!";
  },
});

function emitEvent(onEvent: ((event: AgentEvent) => void) | undefined, event: unknown): void {
  if (!onEvent) {
    return;
  }
  onEvent(event as AgentEvent);
}

const createFailingAgent = (): AgentLike => ({
  name: "fail-agent",
  run: async (): Promise<string> => {
    throw new Error("agent exploded");
  },
});

const createHistoryCapturingAgent = (): AgentLike & {
  capturedMessages: ConversationMessage[] | undefined;
} => {
  const agent = {
    capturedMessages: undefined as ConversationMessage[] | undefined,
    name: "history-agent",
    run: async (
      input: string,
      _provider: LLMProvider,
      options?: { messages?: Array<ConversationMessage>; onEvent?: (event: AgentEvent) => void }
    ): Promise<string> => {
      agent.capturedMessages = options?.messages;
      if (options?.onEvent) {
        emitEvent(options.onEvent, {
          input,
          sessionId: "history-session",
          timestamp: Date.now(),
          type: "session.start",
        });
        emitEvent(options.onEvent, {
          phase: "summarizing",
          timestamp: Date.now(),
          turn: 0,
          type: "turn.start",
        });
        emitEvent(options.onEvent, { timestamp: Date.now(), turn: 0, type: "stream.start" });
        emitEvent(options.onEvent, {
          content: "reply",
          phase: "summarizing",
          timestamp: Date.now(),
          type: "stream.chunk",
        });
        emitEvent(options.onEvent, {
          summary: "reply",
          timestamp: Date.now(),
          type: "agent.complete",
          usage: { llmCalls: 1, totalInputTokens: 5, totalOutputTokens: 3 },
        });
        emitEvent(options.onEvent, {
          status: "completed",
          timestamp: Date.now(),
          turn: 0,
          type: "turn.end",
        });
        emitEvent(options.onEvent, {
          output: "reply",
          sessionId: "history-session",
          status: "complete",
          timestamp: Date.now(),
          turns: 1,
          type: "session.end",
        });
      }
      return "reply";
    },
  };
  return agent;
};

const createToolCallingAgent = (): AgentLike => ({
  name: "tool-agent",
  run: async (
    _input: string,
    _provider: LLMProvider,
    options?: { messages?: Array<ConversationMessage>; onEvent?: (event: AgentEvent) => void }
  ): Promise<string> => {
    if (options?.onEvent) {
      emitEvent(options.onEvent, {
        sessionId: "tool-session",
        timestamp: Date.now(),
        type: "session.start",
      });
      emitEvent(options.onEvent, {
        phase: "executing",
        timestamp: Date.now(),
        turn: 0,
        type: "turn.start",
      });
      emitEvent(options.onEvent, { timestamp: Date.now(), turn: 0, type: "stream.start" });
      emitEvent(options.onEvent, {
        content: "Let me search for that.",
        phase: "executing",
        timestamp: Date.now(),
        type: "stream.chunk",
      });
      emitEvent(options.onEvent, {
        args: { query: "test" },
        timestamp: Date.now(),
        toolName: "search",
        toolUseId: "tu-001",
        type: "tool.call",
      });
      emitEvent(options.onEvent, {
        isError: false,
        result: "Found 3 results",
        timestamp: Date.now(),
        toolName: "search",
        toolUseId: "tu-001",
        type: "tool.result",
      });
      emitEvent(options.onEvent, {
        content: "Here are the results.",
        phase: "summarizing",
        timestamp: Date.now(),
        type: "stream.chunk",
      });
      emitEvent(options.onEvent, {
        summary: "Search completed",
        timestamp: Date.now(),
        type: "agent.complete",
        usage: { llmCalls: 2, totalInputTokens: 20, totalOutputTokens: 15 },
      });
      emitEvent(options.onEvent, {
        status: "completed",
        timestamp: Date.now(),
        turn: 0,
        type: "turn.end",
      });
      emitEvent(options.onEvent, {
        output: "Search completed",
        sessionId: "tool-session",
        status: "complete",
        timestamp: Date.now(),
        turns: 1,
        type: "session.end",
      });
    }
    return "Search completed";
  },
});

interface AgentCoreSSEEvent {
  data: {
    data: Record<string, unknown>;
    sessionId: string;
    timestamp: number;
    turnId?: string;
    type: string;
  };
  event?: string;
}

const createTurnTrackingAgent = (): AgentLike => ({
  name: "turn-tracking-agent",
  run: async (
    _input: string,
    _provider: LLMProvider,
    options?: { messages?: Array<ConversationMessage>; onEvent?: (event: AgentEvent) => void }
  ): Promise<string> => {
    if (options?.onEvent) {
      emitEvent(options.onEvent, {
        sessionId: "turn-session",
        timestamp: Date.now(),
        type: "session.start",
      });
      emitEvent(options.onEvent, {
        phase: "executing",
        timestamp: Date.now(),
        turn: 0,
        turnId: "turn-123",
        type: "turn.start",
      });
      emitEvent(options.onEvent, {
        timestamp: Date.now(),
        turn: 0,
        turnId: "turn-123",
        type: "stream.start",
      });
      emitEvent(options.onEvent, {
        content: "tracked chunk",
        phase: "executing",
        timestamp: Date.now(),
        type: "stream.chunk",
      });
      emitEvent(options.onEvent, {
        status: "completed",
        timestamp: Date.now(),
        turn: 0,
        turnId: "turn-123",
        type: "turn.end",
      });
      emitEvent(options.onEvent, {
        output: "done",
        sessionId: "turn-session",
        status: "complete",
        timestamp: Date.now(),
        turns: 1,
        type: "session.end",
      });
    }
    return "done";
  },
});

async function parseSSE(response: Response): Promise<Array<AgentCoreSSEEvent>> {
  const events: Array<AgentCoreSSEEvent> = [];
  const text = await response.text();
  const blocks = text.split("\n\n");
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    const dataLines = lines
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6));
    if (dataLines.length > 0) {
      try {
        events.push({
          data: JSON.parse(dataLines.join("\n")) as AgentCoreSSEEvent["data"],
          event: lines.find((line) => line.startsWith("event: "))?.slice(7),
        });
      } catch {
        /* noop */
      }
    }
  }
  return events;
}

function extractEventsByType(
  events: Array<AgentCoreSSEEvent>,
  type: string
): Array<AgentCoreSSEEvent> {
  return events.filter((event) => event.data.type === type);
}

function extractChunkTexts(events: Array<AgentCoreSSEEvent>): Array<string> {
  return extractEventsByType(events, "stream.chunk").map((event) =>
    String(event.data.data.content)
  );
}

// --- Test Suites ---

describe("AgentCore protocol via serve()", () => {
  describe("POST /invocations — { message } format", () => {
    let server: ReturnType<typeof serve>;

    beforeAll(() => {
      server = serve(createMockAgent(), mockProvider, { port: 0, protocol: "agentcore" });
    });

    afterAll(() => {
      server.stop();
    });

    it("returns SSE stream with full Strands lifecycle", async () => {
      const res = await fetch(`http://localhost:${server.port}/invocations`, {
        body: JSON.stringify({ message: "Hello" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      expect(res.headers.get("cache-control")).toBe("no-cache");

      const events = await parseSSE(res);

      expect(events.length).toBeGreaterThanOrEqual(7);
      expect(events[0].event).toBe("session.start");
      expect(events[0].data.type).toBe("session.start");
      expect(events[0].data.sessionId).toBe("framework-session-1");
      expect(typeof events[0].data.timestamp).toBe("number");

      const chunks = extractChunkTexts(events);
      expect(chunks).toEqual(["Hello ", "world!"]);

      const completion = events.find((event) => event.data.type === "agent.complete");
      expect(completion).toBeDefined();
      expect(completion!.event).toBe("agent.complete");
      expect(completion!.data.data.usage).toEqual({
        llmCalls: 1,
        totalInputTokens: 10,
        totalOutputTokens: 5,
      });

      const last = events.at(-1)!;
      expect(last.event).toBe("session.end");
      expect(last.data.type).toBe("session.end");
      expect(last.data.data.status).toBe("complete");
      expect(last.data.sessionId).toBe("framework-session-1");
    });
  });

  describe("POST /invocations — { prompt } format", () => {
    let server: ReturnType<typeof serve>;

    beforeAll(() => {
      server = serve(createMockAgent(), mockProvider, { port: 0, protocol: "agentcore" });
    });

    afterAll(() => {
      server.stop();
    });

    it("joins prompt[] texts and streams response", async () => {
      const res = await fetch(`http://localhost:${server.port}/invocations`, {
        body: JSON.stringify({
          prompt: [{ text: "Hello" }, { text: "world" }],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(200);
      const events = await parseSSE(res);
      expect(events.length).toBeGreaterThanOrEqual(7);
      expect(events[0].event).toBe("session.start");
      expect(events.at(-1)!.event).toBe("session.end");
    });
  });

  describe("POST /invocations — { messages } format with history", () => {
    it("passes conversation history to agent", async () => {
      const historyAgent = createHistoryCapturingAgent();
      const server = serve(historyAgent, mockProvider, { port: 0, protocol: "agentcore" });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({
            messages: [
              { content: "Previous question", role: "user" },
              { content: "Previous answer", role: "assistant" },
              { content: "Current question", role: "user" },
            ],
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        expect(res.status).toBe(200);
        const events = await parseSSE(res);
        expect(events.at(-1)!.event).toBe("session.end");

        expect(historyAgent.capturedMessages).toBeDefined();
        expect(historyAgent.capturedMessages).toHaveLength(2);
        expect(historyAgent.capturedMessages![0]).toEqual({
          content: "Previous question",
          role: "user",
        });
        expect(historyAgent.capturedMessages![1]).toEqual({
          content: "Previous answer",
          role: "assistant",
        });
      } finally {
        server.stop();
      }
    });

    it("handles messages with array content", async () => {
      const historyAgent = createHistoryCapturingAgent();
      const server = serve(historyAgent, mockProvider, { port: 0, protocol: "agentcore" });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({
            messages: [{ content: [{ text: "Part 1" }, { text: "Part 2" }], role: "user" }],
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        expect(res.status).toBe(200);
        const events = await parseSSE(res);
        expect(events.length).toBeGreaterThanOrEqual(7);
      } finally {
        server.stop();
      }
    });
  });

  describe("providerFactory integration", () => {
    it("uses providerFactory when model is provided as string", async () => {
      const agent = createMockAgent();
      const defaultProvider = mockProvider;
      const customProvider: LLMProvider = { ...mockProvider, contextWindowSize: 999 };
      let factoryCalled = false;
      let factoryModel: string | undefined;

      const server = serve(agent, defaultProvider, {
        port: 0,
        protocol: "agentcore",
        providerFactory: (model: string) => {
          factoryCalled = true;
          factoryModel = model;
          return customProvider;
        },
      });

      try {
        await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({ message: "Hello", model: "claude-3" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        expect(factoryCalled).toBe(true);
        expect(factoryModel).toBe("claude-3");
      } finally {
        server.stop();
      }
    });

    it("uses providerFactory when model is object with modelId", async () => {
      const agent = createMockAgent();
      let factoryModel: string | undefined;

      const server = serve(agent, mockProvider, {
        port: 0,
        protocol: "agentcore",
        providerFactory: (model: string) => {
          factoryModel = model;
          return mockProvider;
        },
      });

      try {
        await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({
            message: "Hello",
            model: { modelId: "anthropic.claude-3-haiku", region: "us-east-1" },
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        expect(factoryModel).toBe("anthropic.claude-3-haiku");
      } finally {
        server.stop();
      }
    });

    it("uses default provider when no model specified", async () => {
      let factoryCalled = false;

      const server = serve(createMockAgent(), mockProvider, {
        port: 0,
        protocol: "agentcore",
        providerFactory: () => {
          factoryCalled = true;
          return mockProvider;
        },
      });

      try {
        await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({ message: "Hello" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        expect(factoryCalled).toBe(false);
      } finally {
        server.stop();
      }
    });

    it("awaits async providerFactory before running agent", async () => {
      let seenContextWindow: number | undefined;
      const agent: AgentLike = {
        name: "provider-aware-agent",
        run: async (_input, provider) => {
          seenContextWindow = provider.contextWindowSize;
          return "ok";
        },
      };

      const server = serve(agent, mockProvider, {
        port: 0,
        protocol: "agentcore",
        providerFactory: async (model: string) => ({
          ...mockProvider,
          contextWindowSize: model.length,
        }),
      });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({ message: "Hello", model: "async-model" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        expect(res.status).toBe(200);
        expect(seenContextWindow).toBe("async-model".length);
      } finally {
        server.stop();
      }
    });
  });

  describe("POST /chat endpoint (alias)", () => {
    let server: ReturnType<typeof serve>;

    beforeAll(() => {
      server = serve(createMockAgent(), mockProvider, { port: 0, protocol: "agentcore" });
    });

    afterAll(() => {
      server.stop();
    });

    it("works identically to /invocations", async () => {
      const res = await fetch(`http://localhost:${server.port}/chat`, {
        body: JSON.stringify({ message: "Hello via chat" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");

      const events = await parseSSE(res);
      expect(events[0].event).toBe("session.start");
      expect(events.at(-1)!.event).toBe("session.end");

      const chunks = extractChunkTexts(events);
      expect(chunks).toEqual(["Hello ", "world!"]);
    });
  });

  describe("GET /ping endpoint", () => {
    let server: ReturnType<typeof serve>;

    beforeAll(() => {
      server = serve(createMockAgent(), mockProvider, { port: 0, protocol: "agentcore" });
    });

    afterAll(() => {
      server.stop();
    });

    it("returns healthy status", async () => {
      const res = await fetch(`http://localhost:${server.port}/ping`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { status: string; time_of_last_update: number };
      expect(body.status).toBe("Healthy");
      expect(typeof body.time_of_last_update).toBe("number");
      expect(body.time_of_last_update).toBeGreaterThan(0);
    });
  });

  describe("Error cases", () => {
    let server: ReturnType<typeof serve>;

    beforeAll(() => {
      server = serve(createMockAgent(), mockProvider, { port: 0, protocol: "agentcore" });
    });

    afterAll(() => {
      server.stop();
    });

    it("returns 400 for invalid JSON", async () => {
      const res = await fetch(`http://localhost:${server.port}/invocations`, {
        body: "not json",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Invalid JSON");
    });

    it("returns 400 for empty object (no input)", async () => {
      const res = await fetch(`http://localhost:${server.port}/invocations`, {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBeDefined();
    });

    it("returns 400 for empty message string", async () => {
      const res = await fetch(`http://localhost:${server.port}/invocations`, {
        body: JSON.stringify({ message: "" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown paths", async () => {
      const res = await fetch(`http://localhost:${server.port}/unknown`);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not Found");
    });

    it("returns 404 for wrong HTTP method on /invocations", async () => {
      const res = await fetch(`http://localhost:${server.port}/invocations`);
      expect(res.status).toBe(404);
    });
  });

  describe("Agent error during stream", () => {
    it("emits error envelope and synthetic failed session.end", async () => {
      const server = serve(createFailingAgent(), mockProvider, {
        port: 0,
        protocol: "agentcore",
      });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({ message: "boom" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        expect(res.status).toBe(200);
        const events = await parseSSE(res);

        expect(events).toHaveLength(2);
        expect(events[0].event).toBe("agent.error");
        expect(events[0].data.data.message).toBe("agent exploded");
        expect(events[1].event).toBe("session.end");
        expect(events[1].data.data.status).toBe("failed");
      } finally {
        server.stop();
      }
    });
  });

  describe("ToolCalling events as toolUse contentBlocks", () => {
    it("streams tool lifecycle events without filtering", async () => {
      const server = serve(createToolCallingAgent(), mockProvider, {
        port: 0,
        protocol: "agentcore",
      });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({ message: "search test" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        expect(res.status).toBe(200);
        const events = await parseSSE(res);

        expect(events.some((event) => event.event === "tool.call")).toBe(true);
        expect(events.some((event) => event.event === "tool.result")).toBe(true);
        expect(events.some((event) => event.event === "stream.chunk")).toBe(true);
        expect(events.at(-1)!.event).toBe("session.end");

        const toolCall = events.find((event) => event.event === "tool.call");
        expect(toolCall).toBeDefined();
        expect(toolCall!.data.data).toEqual({
          args: { query: "test" },
          toolName: "search",
          toolUseId: "tu-001",
        });
        expect(typeof toolCall!.data.timestamp).toBe("number");

        const toolResult = events.find((event) => event.event === "tool.result");
        expect(toolResult).toBeDefined();
        expect(toolResult!.data.data).toEqual({
          isError: false,
          result: "Found 3 results",
          toolName: "search",
          toolUseId: "tu-001",
        });
        expect(typeof toolResult!.data.timestamp).toBe("number");
      } finally {
        server.stop();
      }
    });
  });

  describe("Client disconnect handling", () => {
    it("does not crash when client aborts mid-stream", async () => {
      const slowAgent: AgentLike = {
        name: "slow-agent",
        run: async (
          _input: string,
          _provider: LLMProvider,
          options?: { onEvent?: (event: AgentEvent) => void }
        ): Promise<string> => {
          if (options?.onEvent) {
            emitEvent(options.onEvent, {
              sessionId: "slow-session",
              timestamp: Date.now(),
              type: "session.start",
            });
            emitEvent(options.onEvent, { timestamp: Date.now(), turn: 0, type: "stream.start" });
            for (let i = 0; i < 20; i++) {
              await new Promise((r) => setTimeout(r, 50));
              emitEvent(options.onEvent, {
                content: `chunk-${i} `,
                phase: "summarizing",
                timestamp: Date.now(),
                type: "stream.chunk",
              });
            }
            emitEvent(options.onEvent, {
              summary: "done",
              timestamp: Date.now(),
              type: "agent.complete",
              usage: { llmCalls: 1, totalInputTokens: 1, totalOutputTokens: 1 },
            });
            emitEvent(options.onEvent, {
              output: "done",
              sessionId: "slow-session",
              status: "complete",
              timestamp: Date.now(),
              turns: 1,
              type: "session.end",
            });
          }
          return "done";
        },
      };

      const server = serve(slowAgent, mockProvider, { port: 0, protocol: "agentcore" });

      try {
        const controller = new AbortController();

        const resPromise = fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({ message: "slow request" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });

        await new Promise((r) => setTimeout(r, 100));
        controller.abort();

        try {
          const res = await resPromise;
          await res.text();
        } catch {
          /* expected abort or partial read */
        }

        const pingRes = await fetch(`http://localhost:${server.port}/ping`);
        expect(pingRes.status).toBe(200);
      } finally {
        await new Promise((r) => setTimeout(r, 1200));
        server.stop();
      }
    });
  });

  describe("SSE envelope", () => {
    it("adds event field, sessionId, and timestamp", async () => {
      const server = serve(createToolCallingAgent(), mockProvider, {
        port: 0,
        protocol: "agentcore",
      });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({ message: "search test", session_id: "req-session" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        const events = await parseSSE(res);
        expect(events.length).toBeGreaterThan(0);

        for (const event of events) {
          expect(event.event).toBe(event.data.type);
          expect(typeof event.data.timestamp).toBe("number");
          expect(event.data.timestamp).toBeGreaterThan(0);
          expect(event.data.sessionId).toBe("tool-session");
        }
      } finally {
        server.stop();
      }
    });

    it("closes stream on session.end", async () => {
      const server = serve(createMockAgent(), mockProvider, { port: 0, protocol: "agentcore" });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({ message: "Hello" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        const text = await res.text();
        const sessionEndCount = (text.match(/^event: session\.end$/gm) ?? []).length;
        expect(sessionEndCount).toBe(1);
        expect(
          text
            .trimEnd()
            .endsWith('data: {"type":"session.end","sessionId":"framework-session-1","timestamp":')
        ).toBe(false);
        const blocks = text.trim().split("\n\n");
        expect(blocks.at(-1)?.includes("event: session.end")).toBe(true);
      } finally {
        server.stop();
      }
    });

    it("propagates turnId until turn.end and clears it for session.end", async () => {
      const server = serve(createTurnTrackingAgent(), mockProvider, {
        port: 0,
        protocol: "agentcore",
      });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({ message: "track turn" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        const events = await parseSSE(res);
        const turnStart = events.find((event) => event.event === "turn.start");
        const streamChunk = events.find((event) => event.event === "stream.chunk");
        const turnEnd = events.find((event) => event.event === "turn.end");
        const sessionEnd = events.find((event) => event.event === "session.end");

        expect(turnStart?.data.turnId).toBe("turn-123");
        expect(streamChunk?.data.turnId).toBe("turn-123");
        expect(turnEnd?.data.turnId).toBe("turn-123");
        expect(sessionEnd?.data.turnId).toBeUndefined();
      } finally {
        server.stop();
      }
    });
  });

  describe("Port defaults", () => {
    it("defaults to 8080 for agentcore protocol", () => {
      const originalPort = process.env.PORT;
      delete process.env.PORT;

      try {
        const server = serve(createMockAgent(), mockProvider, { protocol: "agentcore" });
        expect(server.port).toBe(8080);
        server.stop();
      } finally {
        if (originalPort !== undefined) {
          process.env.PORT = originalPort;
        }
      }
    });

    it("respects PORT env var", () => {
      const originalPort = process.env.PORT;
      process.env.PORT = "19099";

      try {
        const server = serve(createMockAgent(), mockProvider, { protocol: "agentcore" });
        expect(server.port).toBe(19_099);
        server.stop();
      } finally {
        if (originalPort !== undefined) {
          process.env.PORT = originalPort;
        } else {
          delete process.env.PORT;
        }
      }
    });

    it("respects opts.port over defaults", () => {
      const server = serve(createMockAgent(), mockProvider, {
        port: 0,
        protocol: "agentcore",
      });
      expect(server.port).toBeGreaterThan(0);
      server.stop();
    });
  });
});
