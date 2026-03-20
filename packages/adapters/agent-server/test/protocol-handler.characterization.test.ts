/**
 * Protocol Handler Characterization Tests
 *
 * Purpose: Pin current A2A/AgentCore protocol behavior to enable safe internal
 * refactoring and deduplication. These tests capture the EXACT current behavior
 * of request parsing, stream flows, SSE formatting, and error handling.
 *
 * Rules:
 *   - Tests are READ-ONLY observers; they document current behavior
 *   - DO NOT change production code based on these tests
 *   - Any change to these tests indicates a breaking protocol change
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AgentEvent, LLMProvider } from "@obsku/framework";
import { HTTP_STATUS } from "../src/constants";
import { type AgentLike, serve } from "../src/index";
import { parseAgentCoreRequest } from "../src/parse-request";
import { formatSSEMessage } from "../src/shared";

// ---------------------------------------------------------------------------
// Mock Providers & Agents
// ---------------------------------------------------------------------------

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
  contextWindowSize: 8192,
};

// Agent that emits multiple stream chunks
const multiChunkAgent: AgentLike = {
  name: "multi-chunk-agent",
  run: async (
    input: string,
    _provider: LLMProvider,
    options?: { onEvent?: (event: AgentEvent) => void }
  ): Promise<string> => {
    if (options?.onEvent) {
      const words = input.split(" ");
      for (const word of words) {
        options.onEvent({
          content: word + " ",
          phase: "summarizing",
          timestamp: Date.now(),
          type: "stream.chunk",
        });
      }
    }
    return `Processed: ${input}`;
  },
};

// Agent that throws an error
const errorAgent: AgentLike = {
  name: "error-agent",
  run: async (): Promise<string> => {
    throw new Error("Simulated agent failure");
  },
};

// Agent that throws a non-Error object
const weirdErrorAgent: AgentLike = {
  name: "weird-error-agent",
  run: async (): Promise<string> => {
    // eslint-disable-next-line no-throw-literal
    throw "String error";
  },
};

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

interface A2ASSEEvent {
  id: string | number | null;
  jsonrpc: string;
  result?: {
    artifactUpdate?: {
      artifact: {
        parts: Array<{ kind: string; text: string }>;
      };
      taskId: string;
    };
    task?: {
      status: {
        error?: string;
        state: string;
      };
      taskId?: string;
    };
  };
}

interface AgentCoreSSEEvent {
  event: Record<string, unknown>;
}

async function collectA2ASSE(port: number, body: unknown): Promise<Array<A2ASSEEvent>> {
  const res = await fetch(`http://localhost:${port}/`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)) as A2ASSEEvent);
}

async function parseAgentCoreSSE(response: Response): Promise<Array<AgentCoreSSEEvent>> {
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
        const parsed = JSON.parse(dataLines.join("\n")) as AgentCoreSSEEvent;
        events.push(parsed);
      } catch {
        /* noop */
      }
    }
  }
  return events;
}

function getStrandsEventName(event: AgentCoreSSEEvent): string | undefined {
  return Object.keys(event.event)[0];
}

function getStrandsEventPayload(
  event: AgentCoreSSEEvent,
  name: string
): Record<string, unknown> | undefined {
  const payload = event.event[name];
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
}

// ---------------------------------------------------------------------------
// A2A Protocol Characterization
// ---------------------------------------------------------------------------

describe("A2A Protocol Characterization", () => {
  describe("Request Parsing", () => {
    let server: ReturnType<typeof serve>;
    const testPort = 19_100;

    beforeAll(() => {
      server = serve(multiChunkAgent, mockProvider, {
        port: testPort,
        skills: ["test"],
      });
    });

    afterAll(() => {
      server.stop();
    });

    it("parses message with text parts and extracts prompt", async () => {
      const res = await fetch(`http://localhost:${testPort}/`, {
        body: JSON.stringify({
          id: "req-001",
          jsonrpc: "2.0",
          method: "message/send",
          params: {
            message: {
              messageId: "msg-001",
              parts: [{ kind: "text", text: "Hello, agent!" }],
              role: "user",
            },
          },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(HTTP_STATUS.OK);
      const body = await res.json();
      // Pin: response uses request id
      expect(body.id).toBe("req-001");
      // Pin: artifacts array contains response
      expect(body.result.artifacts[0].parts[0].text).toBe("Processed: Hello, agent!");
    });

    it("returns JSON-RPC parse error for invalid JSON", async () => {
      const res = await fetch(`http://localhost:${testPort}/`, {
        body: "not valid json",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST);
      const body = await res.json();
      // Pin: JSON-RPC 2.0 error format with code -32700
      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBeNull();
      expect(body.error.code).toBe(-32_700);
      expect(body.error.message).toBe("Parse error");
    });

    it("returns JSON-RPC method not found for unknown method", async () => {
      const res = await fetch(`http://localhost:${testPort}/`, {
        body: JSON.stringify({
          id: "req-002",
          jsonrpc: "2.0",
          method: "unknown/method",
          params: {},
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST);
      const body = await res.json();
      // Pin: JSON-RPC 2.0 error format with code -32601
      expect(body.error.code).toBe(-32_601);
      expect(body.error.message).toBe("Method not found");
    });

    it("handles empty parts array gracefully", async () => {
      const res = await fetch(`http://localhost:${testPort}/`, {
        body: JSON.stringify({
          id: "req-003",
          jsonrpc: "2.0",
          method: "message/send",
          params: {
            message: {
              parts: [],
              role: "user",
            },
          },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(HTTP_STATUS.OK);
      const body = await res.json();
      // Pin: empty input produces "Processed: " response
      expect(body.result.artifacts[0].parts[0].text).toBe("Processed: ");
    });
  });

  describe("Stream Flow (message/stream)", () => {
    let server: ReturnType<typeof serve>;
    const testPort = 19_101;

    beforeAll(() => {
      server = serve(multiChunkAgent, mockProvider, {
        port: testPort,
        skills: ["streaming"],
      });
    });

    afterAll(() => {
      server.stop();
    });

    it("emits working → artifactUpdates → completed sequence", async () => {
      const events = await collectA2ASSE(testPort, {
        id: "stream-1",
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            parts: [{ kind: "text", text: "Hello world" }],
            role: "user",
          },
        },
      });

      // Pin: A2A stream always starts with task(working)
      expect(events[0].result?.task?.status.state).toBe("working");
      const taskId = events[0].result?.task?.taskId;
      expect(taskId).toBeDefined();

      // Pin: middle events are artifactUpdates with matching taskId
      const artifactEvents = events.slice(1, -1);
      expect(artifactEvents.length).toBeGreaterThanOrEqual(1);
      for (const evt of artifactEvents) {
        expect(evt.result?.artifactUpdate?.taskId).toBe(taskId);
        expect(evt.result?.artifactUpdate?.artifact.parts[0].kind).toBe("text");
      }

      // Pin: stream ends with task(completed)
      const last = events.at(-1);
      expect(last?.result?.task?.status.state).toBe("completed");
      expect(last?.result?.task?.taskId).toBe(taskId);
    });

    it("preserves request ID in all SSE events", async () => {
      const events = await collectA2ASSE(testPort, {
        id: 42,
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            parts: [{ kind: "text", text: "test" }],
            role: "user",
          },
        },
      });

      // Pin: numeric IDs are preserved
      for (const evt of events) {
        expect(evt.id).toBe(42);
        expect(evt.jsonrpc).toBe("2.0");
      }
    });

    it("preserves null request ID", async () => {
      const events = await collectA2ASSE(testPort, {
        id: null,
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            parts: [{ kind: "text", text: "test" }],
            role: "user",
          },
        },
      });

      for (const evt of events) {
        expect(evt.id).toBeNull();
      }
    });
  });

  describe("Error Flow", () => {
    it("emits task(failed) with error message on agent exception", async () => {
      const server = serve(errorAgent, mockProvider, { port: 19_102 });

      try {
        const events = await collectA2ASSE(19_102, {
          id: "error-test",
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: {
              parts: [{ kind: "text", text: "trigger error" }],
              role: "user",
            },
          },
        });

        // Pin: error flow has working → failed (2 events)
        expect(events.length).toBe(2);
        expect(events[0].result?.task?.status.state).toBe("working");
        expect(events[1].result?.task?.status.state).toBe("failed");
        // Pin: error message is in status.error field
        expect(events[1].result?.task?.status.error).toBe("Simulated agent failure");
      } finally {
        server.stop();
      }
    });

    it("emits task(failed) with 'Unknown error' for non-Error throws", async () => {
      const server = serve(weirdErrorAgent, mockProvider, { port: 19_103 });

      try {
        const events = await collectA2ASSE(19_103, {
          id: "weird-error",
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: {
              parts: [{ kind: "text", text: "trigger weird error" }],
              role: "user",
            },
          },
        });

        expect(events.length).toBe(2);
        expect(events[1].result?.task?.status.state).toBe("failed");
        // Pin: non-Error throws result in "Unknown error"
        expect(events[1].result?.task?.status.error).toBe("Unknown error");
      } finally {
        server.stop();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// AgentCore Protocol Characterization
// ---------------------------------------------------------------------------

describe("AgentCore Protocol Characterization", () => {
  describe("Request Parsing", () => {
    it("parses { message: 'hello' } → input: 'hello'", () => {
      const result = parseAgentCoreRequest({ message: "hello" });
      // Pin: message field extracts to input
      expect(result.input).toBe("hello");
      expect(result.messages).toBeUndefined();
    });

    it("parses { prompt: [{ text: 'hello' }] } → input: 'hello'", () => {
      const result = parseAgentCoreRequest({ prompt: [{ text: "hello" }] });
      // Pin: prompt array joins with newlines
      expect(result.input).toBe("hello");
    });

    it("parses messages[] and extracts last user message as input", () => {
      const result = parseAgentCoreRequest({
        messages: [
          { content: "first", role: "user" },
          { content: "response", role: "assistant" },
          { content: "second", role: "user" },
        ],
      });
      // Pin: last user message becomes input, previous are history
      expect(result.input).toBe("second");
      expect(result.messages).toEqual([
        { content: "first", role: "user" },
        { content: "response", role: "assistant" },
      ]);
    });

    it("message takes priority over messages[]", () => {
      const result = parseAgentCoreRequest({
        message: "new",
        messages: [{ content: "prev", role: "user" }],
      });
      // Pin: message field overrides messages[] for input
      expect(result.input).toBe("new");
      // Pin: but messages[] is still preserved as history
      expect(result.messages).toEqual([{ content: "prev", role: "user" }]);
    });

    it("parses model as string", () => {
      const result = parseAgentCoreRequest({
        message: "hello",
        model: "claude-3",
      });
      expect(result.model).toBe("claude-3");
    });

    it("parses model as object with modelId", () => {
      const result = parseAgentCoreRequest({
        message: "hello",
        model: { modelId: "claude-3", region: "us-east-1" },
      });
      // Pin: modelId field is extracted from object
      expect(result.model).toBe("claude-3");
    });

    it("parses session_id → sessionId", () => {
      const result = parseAgentCoreRequest({
        message: "hello",
        session_id: "sess-123",
      });
      // Pin: snake_case session_id maps to camelCase sessionId
      expect(result.sessionId).toBe("sess-123");
    });

    it("throws for empty object", () => {
      // Pin: empty object produces "No input found in request"
      expect(() => parseAgentCoreRequest({})).toThrow("No input found in request");
    });

    it("throws for non-object", () => {
      // Pin: non-objects produce "Request body must be an object"
      expect(() => parseAgentCoreRequest(null)).toThrow("Request body must be an object");
      expect(() => parseAgentCoreRequest("string")).toThrow("Request body must be an object");
    });
  });

  describe("Stream Flow", () => {
    const createEventEmittingAgent = (): AgentLike => ({
      name: "event-agent",
      run: async (
        _input: string,
        _provider: LLMProvider,
        options?: { onEvent?: (event: AgentEvent) => void }
      ): Promise<string> => {
        if (options?.onEvent) {
          options.onEvent({
            input: "test",
            sessionId: "test-session",
            timestamp: Date.now(),
            type: "session.start",
          });
          options.onEvent({
            phase: "summarizing",
            timestamp: Date.now(),
            turn: 0,
            turnId: "turn-001",
            type: "turn.start",
          });
          options.onEvent({
            content: "Hello ",
            phase: "summarizing",
            timestamp: Date.now(),
            type: "stream.chunk",
          });
          options.onEvent({
            content: "world",
            phase: "summarizing",
            timestamp: Date.now(),
            type: "stream.chunk",
          });
          options.onEvent({
            status: "completed",
            timestamp: Date.now(),
            turn: 0,
            turnId: "turn-001",
            type: "turn.end",
          });
          options.onEvent({
            output: "Hello world",
            sessionId: "test-session",
            status: "complete",
            timestamp: Date.now(),
            turns: 1,
            type: "session.end",
          });
        }
        return "Hello world";
      },
    });

    it("emits Strands SSE events without event/session metadata fields", async () => {
      const server = serve(createEventEmittingAgent(), mockProvider, {
        port: 0,
        protocol: "agentcore",
      });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({ message: "test" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        expect(res.status).toBe(HTTP_STATUS.OK);
        const events = await parseAgentCoreSSE(res);
        expect(events.map(getStrandsEventName)).toEqual([
          "messageStart",
          "contentBlockStart",
          "contentBlockDelta",
          "contentBlockDelta",
          "contentBlockStop",
          "messageStop",
        ]);

        expect(getStrandsEventPayload(events[2]!, "contentBlockDelta")?.delta).toEqual({
          text: "Hello ",
        });
        expect(getStrandsEventPayload(events[3]!, "contentBlockDelta")?.delta).toEqual({
          text: "world",
        });

        for (const event of events) {
          expect(JSON.stringify(event)).not.toContain("sessionId");
          expect(JSON.stringify(event)).not.toContain("timestamp");
          expect(JSON.stringify(event)).not.toContain("turnId");
        }
      } finally {
        server.stop();
      }
    });

    it("emits Strands lifecycle from turn.start through turn.end", async () => {
      const server = serve(createEventEmittingAgent(), mockProvider, {
        port: 0,
        protocol: "agentcore",
      });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({ message: "test" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        const events = await parseAgentCoreSSE(res);
        expect(events.map(getStrandsEventName)).toEqual([
          "messageStart",
          "contentBlockStart",
          "contentBlockDelta",
          "contentBlockDelta",
          "contentBlockStop",
          "messageStop",
        ]);
        expect(getStrandsEventPayload(events[0]!, "messageStart")).toEqual({ role: "assistant" });
        expect(getStrandsEventPayload(events[5]!, "messageStop")).toEqual({
          stopReason: "end_turn",
        });
      } finally {
        server.stop();
      }
    });

    it("closes stream on session.end", async () => {
      const server = serve(createEventEmittingAgent(), mockProvider, {
        port: 0,
        protocol: "agentcore",
      });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({ message: "test" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        const events = await parseAgentCoreSSE(res);
        expect(getStrandsEventName(events.at(-1)!)).toBe("messageStop");
        expect(getStrandsEventPayload(events.at(-1)!, "messageStop")).toEqual({
          stopReason: "end_turn",
        });
      } finally {
        server.stop();
      }
    });
  });

  describe("Error Flow", () => {
    it("closes open Strands blocks and emits messageStop(error) on error", async () => {
      const agent: AgentLike = {
        name: "streaming-error-agent",
        run: async (
          _input: string,
          _provider: LLMProvider,
          options?: { onEvent?: (event: AgentEvent) => void }
        ): Promise<string> => {
          options?.onEvent?.({
            phase: "summarizing",
            timestamp: Date.now(),
            turn: 0,
            turnId: "turn-001",
            type: "turn.start",
          });
          options?.onEvent?.({
            content: "partial",
            phase: "summarizing",
            timestamp: Date.now(),
            type: "stream.chunk",
          });
          throw new Error("Simulated agent failure");
        },
      };

      const server = serve(agent, mockProvider, {
        port: 0,
        protocol: "agentcore",
      });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({ message: "trigger error" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        expect(res.status).toBe(HTTP_STATUS.OK);
        const events = await parseAgentCoreSSE(res);

        expect(events.map(getStrandsEventName)).toEqual([
          "messageStart",
          "contentBlockStart",
          "contentBlockDelta",
          "contentBlockStop",
          "messageStop",
        ]);
        expect(getStrandsEventPayload(events[4]!, "messageStop")).toEqual({
          stopReason: "error",
        });
      } finally {
        server.stop();
      }
    });

    it("returns 400 for invalid JSON", async () => {
      const server = serve(multiChunkAgent, mockProvider, {
        port: 0,
        protocol: "agentcore",
      });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: "not json",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST);
        const body = await res.json();
        // Pin: AgentCore error format is { error: string }
        expect(body.error).toContain("Invalid JSON");
      } finally {
        server.stop();
      }
    });

    it("returns 400 for empty request (no input)", async () => {
      const server = serve(multiChunkAgent, mockProvider, {
        port: 0,
        protocol: "agentcore",
      });

      try {
        const res = await fetch(`http://localhost:${server.port}/invocations`, {
          body: JSON.stringify({}),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST);
      } finally {
        server.stop();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// SSE Formatting Characterization
// ---------------------------------------------------------------------------

describe("SSE Formatting Characterization", () => {
  it("formats message with event field and data", () => {
    const message = formatSSEMessage({
      data: { type: "test", content: "hello" },
      event: "test.event",
    });

    // Pin: event line comes first
    expect(message).toMatch(/^event: test\.event\n/);
    // Pin: data line follows with JSON
    expect(message).toContain('data: {"type":"test","content":"hello"}');
    // Pin: ends with double newline
    expect(message).toMatch(/\n\n$/);
  });

  it("formats message without event field (data only)", () => {
    const message = formatSSEMessage({
      data: { type: "test" },
    });

    // Pin: no event line when not provided
    expect(message).not.toContain("event:");
    // Pin: starts with data:
    expect(message).toMatch(/^data: /);
    // Pin: ends with double newline
    expect(message).toMatch(/\n\n$/);
  });

  it("handles multiline data by splitting into multiple data: lines", () => {
    const message = formatSSEMessage({
      data: "line1\nline2\nline3",
      event: "multi",
    });

    // Pin: multiline string data produces multiple data: lines
    const lines = message.split("\n");
    const dataLines = lines.filter((l) => l.startsWith("data: "));
    expect(dataLines.length).toBe(3);
    expect(dataLines[0]).toBe("data: line1");
    expect(dataLines[1]).toBe("data: line2");
    expect(dataLines[2]).toBe("data: line3");
  });

  it("handles string data directly", () => {
    const message = formatSSEMessage({
      data: "plain string",
      event: "string",
    });

    // Pin: string data is not JSON.stringified again
    expect(message).toContain("data: plain string");
  });

  it("produces valid SSE for complex nested objects", () => {
    const message = formatSSEMessage({
      data: {
        nested: {
          array: [1, 2, 3],
          bool: true,
          null: null,
          num: 42,
        },
      },
      event: "complex",
    });

    // Should be parseable as SSE
    const lines = message.split("\n");
    expect(lines[0]).toBe("event: complex");
    // JSON should be valid
    const dataLine = lines.find((l) => l.startsWith("data: "));
    const json = dataLine?.slice(6);
    expect(() => JSON.parse(json!)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Protocol Differences Documentation
// ---------------------------------------------------------------------------

describe("Protocol Differences (Documentation)", () => {
  it("A2A: uses JSON-RPC 2.0 envelope with id, jsonrpc, result/error", async () => {
    const server = serve(multiChunkAgent, mockProvider, { port: 19_104 });

    try {
      const res = await fetch(`http://localhost:19104/`, {
        body: JSON.stringify({
          id: "diff-test",
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: {
              parts: [{ kind: "text", text: "test" }],
              role: "user",
            },
          },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const text = await res.text();
      const lines = text.split("\n").filter((l) => l.startsWith("data: "));
      const events = lines.map((l) => JSON.parse(l.slice(6)));

      // Pin: A2A uses JSON-RPC structure
      for (const evt of events) {
        expect(evt).toHaveProperty("jsonrpc");
        expect(evt).toHaveProperty("id");
        expect(evt).toHaveProperty("result");
        expect(evt.jsonrpc).toBe("2.0");
      }
    } finally {
      server.stop();
    }
  });

  it("AgentCore: uses Strands data envelope without SSE event field", async () => {
    const agent: AgentLike = {
      name: "simple-agent",
      run: async (_input, _provider, options?): Promise<string> => {
        if (options?.onEvent) {
          options.onEvent({
            phase: "summarizing",
            timestamp: 12345,
            turn: 0,
            turnId: "turn-001",
            type: "turn.start",
          });
          options.onEvent({
            content: "done",
            phase: "summarizing",
            timestamp: 12346,
            type: "stream.chunk",
          });
          options.onEvent({
            status: "completed",
            timestamp: 12347,
            turn: 0,
            turnId: "turn-001",
            type: "turn.end",
          });
          options.onEvent({
            sessionId: "sess-1",
            status: "complete",
            timestamp: 12348,
            type: "session.end",
          });
        }
        return "done";
      },
    };

    const server = serve(agent, mockProvider, {
      port: 0,
      protocol: "agentcore",
    });

    try {
      const res = await fetch(`http://localhost:${server.port}/invocations`, {
        body: JSON.stringify({ message: "test" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const text = await res.text();
      const blocks = text.trim().split("\n\n");

      for (const block of blocks) {
        expect(block).toMatch(/^data: \{"event":\{/);
        expect(block).not.toContain("event: ");
      }
    } finally {
      server.stop();
    }
  });

  it("A2A: non-streaming returns JSON directly, not SSE", async () => {
    const server = serve(multiChunkAgent, mockProvider, { port: 19_105 });

    try {
      const res = await fetch(`http://localhost:19105/`, {
        body: JSON.stringify({
          id: "non-stream",
          jsonrpc: "2.0",
          method: "message/send",
          params: {
            message: {
              parts: [{ kind: "text", text: "test" }],
              role: "user",
            },
          },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      // Pin: A2A non-streaming returns JSON, not SSE
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = await res.json();
      expect(body.jsonrpc).toBe("2.0");
      expect(body.result).toBeDefined();
    } finally {
      server.stop();
    }
  });

  it("AgentCore: always returns SSE, even for 'instant' responses", async () => {
    const agent: AgentLike = {
      name: "instant-agent",
      run: async (_input): Promise<string> => {
        return "instant";
      },
    };

    const server = serve(agent, mockProvider, {
      port: 0,
      protocol: "agentcore",
    });

    try {
      const res = await fetch(`http://localhost:${server.port}/invocations`, {
        body: JSON.stringify({ message: "test" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      // Pin: AgentCore always returns SSE
      expect(res.headers.get("content-type")).toBe("text/event-stream");
    } finally {
      server.stop();
    }
  });
});
