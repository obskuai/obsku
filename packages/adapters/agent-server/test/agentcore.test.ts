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
  run: async (
    _input: string,
    _provider: LLMProvider,
    options?: { messages?: Array<ConversationMessage>; onEvent?: (event: AgentEvent) => void }
  ): Promise<string> => {
    if (options?.onEvent) {
      emitEvent(options.onEvent, {
        sessionId: "fail-session",
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
        content: "before boom",
        phase: "executing",
        timestamp: Date.now(),
        type: "stream.chunk",
      });
    }
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
  event: {
    contentBlockDelta?: {
      contentBlockIndex: number;
      delta: { text?: string; toolUse?: { input: string } };
    };
    contentBlockStart?: {
      contentBlockIndex: number;
      start: { text?: string; toolUse?: { name: string; toolUseId: string } };
    };
    contentBlockStop?: {
      contentBlockIndex: number;
    };
    messageStart?: {
      role: string;
    };
    messageStop?: {
      stopReason: string;
    };
    metadata?: {
      usage: { inputTokens: number; outputTokens: number; totalTokens: number };
    };
  };
}

type AgentCoreSSEEventType = keyof AgentCoreSSEEvent["event"];

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
        const parsed = JSON.parse(dataLines.join("\n")) as unknown;
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "event" in parsed &&
          typeof parsed.event === "object" &&
          parsed.event !== null
        ) {
          events.push(parsed as AgentCoreSSEEvent);
        }
      } catch {
        /* noop */
      }
    }
  }
  return events;
}

function getEventType(event: AgentCoreSSEEvent): AgentCoreSSEEventType | undefined {
  const [type] = Object.keys(event.event) as Array<AgentCoreSSEEventType>;
  return type;
}

function extractEventsByType(
  events: Array<AgentCoreSSEEvent>,
  type: AgentCoreSSEEventType
): Array<AgentCoreSSEEvent> {
  return events.filter((event) => getEventType(event) === type);
}

function extractChunkTexts(events: Array<AgentCoreSSEEvent>): Array<string> {
  return extractEventsByType(events, "contentBlockDelta")
    .map((event) => event.event.contentBlockDelta?.delta.text)
    .filter((text): text is string => typeof text === "string");
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

      expect(events).toHaveLength(7);
      expect(events[0].event).toEqual({ messageStart: { role: "assistant" } });
      expect(events[1].event).toEqual({
        contentBlockStart: { contentBlockIndex: 0, start: { text: "" } },
      });

      const chunks = extractChunkTexts(events);
      expect(chunks).toEqual(["Hello ", "world!"]);

      const completion = events.find((event) => getEventType(event) === "metadata");
      expect(completion).toBeDefined();
      expect(completion!.event).toEqual({
        metadata: {
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
        },
      });

      expect(events.at(-2)!.event).toEqual({ messageStop: { stopReason: "end_turn" } });
      expect(events.at(-1)!.event).toEqual({
        metadata: {
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
          },
        },
      });
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
      expect(events).toHaveLength(7);
      expect(events[0].event).toEqual({ messageStart: { role: "assistant" } });
      expect(events.at(-2)!.event).toEqual({ messageStop: { stopReason: "end_turn" } });
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
        expect(events.at(-2)!.event).toEqual({ messageStop: { stopReason: "end_turn" } });

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
        expect(events).toHaveLength(6);
        expect(extractChunkTexts(events)).toEqual(["reply"]);
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
      expect(events[0].event).toEqual({ messageStart: { role: "assistant" } });
      expect(events.at(-2)!.event).toEqual({ messageStop: { stopReason: "end_turn" } });

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
    it("closes open blocks and emits messageStop(error)", async () => {
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

        expect(events).toEqual([
          { event: { messageStart: { role: "assistant" } } },
          {
            event: {
              contentBlockStart: { contentBlockIndex: 0, start: { text: "" } },
            },
          },
          {
            event: {
              contentBlockDelta: {
                contentBlockIndex: 0,
                delta: { text: "before boom" },
              },
            },
          },
          {
            event: {
              contentBlockDelta: {
                contentBlockIndex: 0,
                delta: { text: "\n[Error: agent exploded]" },
              },
            },
          },
          { event: { contentBlockStop: { contentBlockIndex: 0 } } },
          { event: { messageStop: { stopReason: "error" } } },
          {
            event: {
              metadata: {
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
              },
            },
          },
        ]);
      } finally {
        server.stop();
      }
    });
  });

  describe("ToolCalling events as toolUse contentBlocks", () => {
    it("maps tool lifecycle to Strands toolUse content blocks", async () => {
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

        expect(events).toHaveLength(12);
        expect(extractChunkTexts(events)).toEqual([
          "Let me search for that.",
          "Here are the results.",
        ]);

        const toolStarts = extractEventsByType(events, "contentBlockStart").filter(
          (event) => event.event.contentBlockStart?.start.toolUse !== undefined
        );
        expect(toolStarts).toHaveLength(1);
        expect(toolStarts[0]!.event).toEqual({
          contentBlockStart: {
            contentBlockIndex: 1,
            start: { toolUse: { name: "search", toolUseId: "tu-001" } },
          },
        });

        const toolDeltas = extractEventsByType(events, "contentBlockDelta").filter(
          (event) => event.event.contentBlockDelta?.delta.toolUse !== undefined
        );
        expect(toolDeltas).toHaveLength(1);
        expect(toolDeltas[0]!.event).toEqual({
          contentBlockDelta: {
            contentBlockIndex: 1,
            delta: { toolUse: { input: '{"query":"test"}' } },
          },
        });

        expect(extractEventsByType(events, "metadata")).toEqual([
          {
            event: {
              metadata: {
                usage: { inputTokens: 20, outputTokens: 15, totalTokens: 35 },
              },
            },
          },
        ]);
        expect(events.at(-2)!.event).toEqual({ messageStop: { stopReason: "end_turn" } });
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
    it("uses Strands data-only envelope without framework metadata", async () => {
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
          expect(Object.keys(event.event)).toHaveLength(1);
          expect(JSON.stringify(event)).not.toContain("sessionId");
          expect(JSON.stringify(event)).not.toContain("timestamp");
          expect(JSON.stringify(event)).not.toContain("turnId");
        }
      } finally {
        server.stop();
      }
    });

    it("closes stream after final metadata event", async () => {
      const server = serve(createMockAgent(), mockProvider, { port: 0, protocol: "agentcore" });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({ message: "Hello" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        const text = await res.text();
        const eventFieldCount = (text.match(/^event:/gm) ?? []).length;
        expect(eventFieldCount).toBe(0);
        expect(text).not.toContain("session.end");
        const blocks = text.trim().split("\n\n");
        expect(blocks).toHaveLength(7);
        expect(blocks.at(-2)).toBe('data: {"event":{"messageStop":{"stopReason":"end_turn"}}}');
        expect(blocks.at(-1)).toBe(
          'data: {"event":{"metadata":{"usage":{"inputTokens":10,"outputTokens":5,"totalTokens":15}}}}'
        );
      } finally {
        server.stop();
      }
    });

    it("does not leak turnId into Strands output", async () => {
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
        expect(events.map(getEventType)).toEqual([
          "messageStart",
          "contentBlockStart",
          "contentBlockDelta",
          "contentBlockStop",
          "messageStop",
          "metadata",
        ]);
        expect(JSON.stringify(events)).not.toContain("turn-123");
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
