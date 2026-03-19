import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AgentEvent, LLMProvider } from "@obsku/framework";
import { type AgentLike, serve } from "../src/index";

// --- Mock Providers & Agents ---

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

// Agent that emits multiple StreamChunk events
const multiChunkAgent: AgentLike = {
  name: "multi-chunk-agent",
  run: async (
    input: string,
    _provider: LLMProvider,
    options?: { onEvent?: (event: AgentEvent) => void }
  ): Promise<string> => {
    if (options?.onEvent) {
      // Emit multiple chunks simulating a streaming response
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

// Agent that emits no StreamChunk events
const noChunkAgent: AgentLike = {
  name: "no-chunk-agent",
  run: async (input: string): Promise<string> => {
    return `Response: ${input}`;
  },
};

// Agent that throws an error
const errorAgent: AgentLike = {
  name: "error-agent",
  run: async (): Promise<string> => {
    throw new Error("Simulated agent failure");
  },
};

// Agent that throws with non-Error object
const weirdErrorAgent: AgentLike = {
  name: "weird-error-agent",
  run: async (): Promise<string> => {
    // eslint-disable-next-line no-throw-literal
    throw "String error";
  },
};

// --- Test Helpers ---

interface SSEEvent {
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

async function collectSSE(port: number, body: unknown): Promise<Array<SSEEvent>> {
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
    .map((l) => JSON.parse(l.slice(6)) as SSEEvent);
}

// --- Test Suites ---

describe("A2A SSE Streaming (message/stream)", () => {
  describe("SSE lifecycle", () => {
    let server: ReturnType<typeof serve>;
    const testPort = 19_010;

    beforeAll(() => {
      server = serve(multiChunkAgent, mockProvider, {
        description: "Agent for SSE lifecycle tests",
        port: testPort,
        skills: ["streaming"],
      });
    });

    afterAll(() => {
      server.stop();
    });

    it("should emit working → artifactUpdate(s) → completed sequence", async () => {
      const events = await collectSSE(testPort, {
        id: "lifecycle-1",
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            parts: [{ kind: "text", text: "Hello world test" }],
            role: "user",
          },
        },
      });

      // Should have at least 3 events: working, at least one artifactUpdate, completed
      expect(events.length).toBeGreaterThanOrEqual(3);

      // First event: task(working)
      const first = events[0];
      expect(first.jsonrpc).toBe("2.0");
      expect(first.id).toBe("lifecycle-1");
      expect(first.result?.task?.status.state).toBe("working");
      const taskId = first.result?.task?.taskId;
      expect(taskId).toBeDefined();

      // Middle events: artifactUpdates
      const artifactEvents = events.slice(1, -1);
      expect(artifactEvents.length).toBeGreaterThanOrEqual(1);
      for (const evt of artifactEvents) {
        expect(evt.result?.artifactUpdate?.taskId).toBe(taskId);
        expect(evt.result?.artifactUpdate?.artifact.parts).toBeDefined();
        expect(evt.result?.artifactUpdate?.artifact.parts.length).toBeGreaterThanOrEqual(1);
        expect(evt.result?.artifactUpdate?.artifact.parts[0].kind).toBe("text");
      }

      // Last event: task(completed)
      const last = events.at(-1);
      expect(last.result?.task?.status.state).toBe("completed");
      expect(last.result?.task?.taskId).toBe(taskId);
    });

    it("should preserve same taskId across all events in a stream", async () => {
      const events = await collectSSE(testPort, {
        id: "taskid-test",
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            parts: [{ kind: "text", text: "Check task ID" }],
            role: "user",
          },
        },
      });

      const firstTaskId = events[0].result?.task?.taskId;
      expect(firstTaskId).toBeDefined();

      for (const evt of events) {
        if (evt.result?.task?.taskId) {
          expect(evt.result.task.taskId).toBe(firstTaskId);
        }
        if (evt.result?.artifactUpdate?.taskId) {
          expect(evt.result.artifactUpdate.taskId).toBe(firstTaskId);
        }
      }
    });

    it("should handle multiple chunks from agent", async () => {
      const events = await collectSSE(testPort, {
        id: "multi-chunk",
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            parts: [{ kind: "text", text: "One Two Three Four Five" }],
            role: "user",
          },
        },
      });

      // Should have: working + 5 chunks + completed = 7 events
      expect(events.length).toBe(7);

      const artifactEvents = events.slice(1, -1);
      expect(artifactEvents).toHaveLength(5);

      const contents = artifactEvents.map((e) => e.result?.artifactUpdate?.artifact.parts[0].text);
      expect(contents).toEqual(["One ", "Two ", "Three ", "Four ", "Five "]);
    });
  });

  describe("message/send still works (non-streaming)", () => {
    let server: ReturnType<typeof serve>;
    const testPort = 19_011;

    beforeAll(() => {
      server = serve(multiChunkAgent, mockProvider, {
        description: "Agent for non-streaming tests",
        port: testPort,
        skills: ["regular"],
      });
    });

    afterAll(() => {
      server.stop();
    });

    it("should return single JSON-RPC response for message/send", async () => {
      const res = await fetch(`http://localhost:${testPort}/`, {
        body: JSON.stringify({
          id: "non-stream-1",
          jsonrpc: "2.0",
          method: "message/send",
          params: {
            message: {
              parts: [{ kind: "text", text: "Regular request" }],
              role: "user",
            },
          },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");

      const body = await res.json();
      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBe("non-stream-1");
      expect(body.result).toBeDefined();
      expect(body.result.artifacts).toHaveLength(1);
      expect(body.result.artifacts[0].name).toBe("agent_response");
      expect(body.result.artifacts[0].parts[0].kind).toBe("text");
      expect(body.result.artifacts[0].parts[0].text).toBe("Processed: Regular request");
    });

    it("should handle empty text in message/send", async () => {
      const res = await fetch(`http://localhost:${testPort}/`, {
        body: JSON.stringify({
          id: "non-stream-empty",
          jsonrpc: "2.0",
          method: "message/send",
          params: {
            message: {
              parts: [{ kind: "text", text: "" }],
              role: "user",
            },
          },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const body = await res.json();
      expect(body.result.artifacts[0].parts[0].text).toBe("Processed: ");
    });
  });

  describe("Error handling", () => {
    it("should emit task(failed) when agent throws Error", async () => {
      const server = serve(errorAgent, mockProvider, { port: 19_012 });

      try {
        const events = await collectSSE(19_012, {
          id: "error-test",
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: {
              parts: [{ kind: "text", text: "Trigger error" }],
              role: "user",
            },
          },
        });

        // Should have: working + failed = 2 events
        expect(events.length).toBe(2);

        const first = events[0];
        expect(first.result?.task?.status.state).toBe("working");

        const last = events.at(-1);
        expect(last.result?.task?.status.state).toBe("failed");
        expect(last.result?.task?.status.error).toBe("Simulated agent failure");
      } finally {
        server.stop();
      }
    });

    it("should emit task(failed) with 'Unknown error' for non-Error throws", async () => {
      const server = serve(weirdErrorAgent, mockProvider, { port: 19_013 });

      try {
        const events = await collectSSE(19_013, {
          id: "weird-error-test",
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: {
              parts: [{ kind: "text", text: "Trigger weird error" }],
              role: "user",
            },
          },
        });

        expect(events.length).toBe(2);

        const last = events.at(-1);
        expect(last.result?.task?.status.state).toBe("failed");
        expect(last.result?.task?.status.error).toBe("Unknown error");
      } finally {
        server.stop();
      }
    });
  });

  describe("Request ID preservation", () => {
    let server: ReturnType<typeof serve>;
    const testPort = 19_014;

    beforeAll(() => {
      server = serve(multiChunkAgent, mockProvider, {
        port: testPort,
        skills: ["id-test"],
      });
    });

    afterAll(() => {
      server.stop();
    });

    it("should preserve string request ID in all SSE events", async () => {
      const events = await collectSSE(testPort, {
        id: "string-id-123",
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            parts: [{ kind: "text", text: "Test" }],
            role: "user",
          },
        },
      });

      for (const evt of events) {
        expect(evt.id).toBe("string-id-123");
        expect(evt.jsonrpc).toBe("2.0");
      }
    });

    it("should preserve numeric request ID in all SSE events", async () => {
      const events = await collectSSE(testPort, {
        id: 42,
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            parts: [{ kind: "text", text: "Test" }],
            role: "user",
          },
        },
      });

      for (const evt of events) {
        expect(evt.id).toBe(42);
      }
    });

    it("should handle null request ID", async () => {
      const events = await collectSSE(testPort, {
        id: null,
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            parts: [{ kind: "text", text: "Test" }],
            role: "user",
          },
        },
      });

      for (const evt of events) {
        expect(evt.id).toBeNull();
      }
    });
  });

  describe("Empty/invalid parts handling", () => {
    let server: ReturnType<typeof serve>;
    const testPort = 19_015;

    beforeAll(() => {
      server = serve(noChunkAgent, mockProvider, {
        port: testPort,
        skills: ["empty-test"],
      });
    });

    afterAll(() => {
      server.stop();
    });

    it("should handle empty parts array gracefully", async () => {
      const events = await collectSSE(testPort, {
        id: "empty-parts",
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            parts: [],
            role: "user",
          },
        },
      });

      // Should still complete the stream
      expect(events.length).toBe(2);
      expect(events[0].result?.task?.status.state).toBe("working");
      expect(events.at(-1).result?.task?.status.state).toBe("completed");
    });

    it("should handle missing parts field gracefully", async () => {
      const events = await collectSSE(testPort, {
        id: "missing-parts",
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            role: "user",
          },
        },
      });

      expect(events.length).toBe(2);
      expect(events.at(-1).result?.task?.status.state).toBe("completed");
    });

    it("should handle parts without text kind gracefully", async () => {
      const events = await collectSSE(testPort, {
        id: "no-text-kind",
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            parts: [{ kind: "image", url: "http://example.com/img.png" }],
            role: "user",
          },
        },
      });

      expect(events.length).toBe(2);
      expect(events.at(-1).result?.task?.status.state).toBe("completed");
    });

    it("should handle message without parts or text", async () => {
      const events = await collectSSE(testPort, {
        id: "bare-message",
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            role: "user",
          },
        },
      });

      expect(events.length).toBe(2);
      expect(events[0].result?.task?.status.state).toBe("working");
      expect(events.at(-1).result?.task?.status.state).toBe("completed");
    });
  });

  describe("Multiple chunks scenario", () => {
    it("should handle agent that emits many small chunks", async () => {
      // Create an agent that emits many chunks
      const manyChunkAgent: AgentLike = {
        name: "many-chunk-agent",
        run: async (
          _input: string,
          _provider: LLMProvider,
          options?: { onEvent?: (event: AgentEvent) => void }
        ): Promise<string> => {
          if (options?.onEvent) {
            for (let i = 0; i < 10; i++) {
              options.onEvent({
                content: `chunk-${i} `,
                phase: "summarizing",
                timestamp: Date.now(),
                type: "stream.chunk",
              });
            }
          }
          return "Many chunks emitted";
        },
      };

      const server = serve(manyChunkAgent, mockProvider, { port: 19_016 });

      try {
        const events = await collectSSE(19_016, {
          id: "many-chunks",
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: {
              parts: [{ kind: "text", text: "Generate many chunks" }],
              role: "user",
            },
          },
        });

        // Should have: working + 10 chunks + completed = 12 events
        expect(events.length).toBe(12);

        const artifactEvents = events.slice(1, -1);
        expect(artifactEvents).toHaveLength(10);

        for (let i = 0; i < 10; i++) {
          expect(artifactEvents[i].result?.artifactUpdate?.artifact.parts[0].text).toBe(
            `chunk-${i} `
          );
        }
      } finally {
        server.stop();
      }
    });

    it("should handle agent that emits empty chunks", async () => {
      const emptyChunkAgent: AgentLike = {
        name: "empty-chunk-agent",
        run: async (
          _input: string,
          _provider: LLMProvider,
          options?: { onEvent?: (event: AgentEvent) => void }
        ): Promise<string> => {
          if (options?.onEvent) {
            options.onEvent({
              content: "",
              phase: "summarizing",
              timestamp: Date.now(),
              type: "stream.chunk",
            });
            options.onEvent({
              content: "has content",
              phase: "summarizing",
              timestamp: Date.now(),
              type: "stream.chunk",
            });
            options.onEvent({
              content: "",
              phase: "summarizing",
              timestamp: Date.now(),
              type: "stream.chunk",
            });
          }
          return "Done";
        },
      };

      const server = serve(emptyChunkAgent, mockProvider, { port: 19_017 });

      try {
        const events = await collectSSE(19_017, {
          id: "empty-chunks",
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: {
              parts: [{ kind: "text", text: "Test empty chunks" }],
              role: "user",
            },
          },
        });

        // Should have: working + 3 chunks (even empty ones) + completed = 5 events
        expect(events.length).toBe(5);

        const contents = events
          .slice(1, -1)
          .map((e) => e.result?.artifactUpdate?.artifact.parts[0].text);
        expect(contents).toEqual(["", "has content", ""]);
      } finally {
        server.stop();
      }
    });
  });

  describe("SSE response format", () => {
    let server: ReturnType<typeof serve>;
    const testPort = 19_018;

    beforeAll(() => {
      server = serve(multiChunkAgent, mockProvider, {
        port: testPort,
        skills: ["format-test"],
      });
    });

    afterAll(() => {
      server.stop();
    });

    it("should have correct SSE headers", async () => {
      const res = await fetch(`http://localhost:${testPort}/`, {
        body: JSON.stringify({
          id: "header-test",
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: {
              parts: [{ kind: "text", text: "Test headers" }],
              role: "user",
            },
          },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("connection")).toBe("keep-alive");
    });

    it("should format all events as valid SSE data lines", async () => {
      const res = await fetch(`http://localhost:${testPort}/`, {
        body: JSON.stringify({
          id: "format-test",
          jsonrpc: "2.0",
          method: "message/stream",
          params: {
            message: {
              parts: [{ kind: "text", text: "Test format" }],
              role: "user",
            },
          },
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const text = await res.text();
      const lines = text.split("\n");

      // Every data line should start with "data: " and be valid JSON
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6);
          const parsed = JSON.parse(jsonStr);
          expect(parsed.jsonrpc).toBe("2.0");
          expect(parsed).toHaveProperty("id");
          expect(parsed).toHaveProperty("result");
        }
      }
    });
  });
});
