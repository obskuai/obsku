import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AgentEvent, LLMProvider } from "@obsku/framework";
import { type AgentLike, serve } from "../src/index";

// Simple mock agent for testing
const mockAgent: AgentLike = {
  name: "test-agent",
  run: async (
    input: string,
    _provider: LLMProvider,
    options?: { onEvent?: (event: AgentEvent) => void }
  ): Promise<string> => {
    if (options?.onEvent) {
      options.onEvent({
        content: "Hello ",
        phase: "summarizing",
        timestamp: Date.now(),
        type: "stream.chunk",
      });
      options.onEvent({
        content: "World",
        phase: "summarizing",
        timestamp: Date.now(),
        type: "stream.chunk",
      });
    }
    return `Response to: ${input}`;
  },
};

const mockFailingAgent: AgentLike = {
  name: "fail-agent",
  run: async (
    _input: string,
    _provider: LLMProvider,
    _options?: { onEvent?: (event: AgentEvent) => void }
  ): Promise<string> => {
    throw new Error("agent exploded");
  },
};

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

interface PingResponse {
  status: string;
  time_of_last_update: number;
}

interface AgentCard {
  capabilities: { streaming: boolean };
  defaultInputModes: Array<string>;
  defaultOutputModes: Array<string>;
  description: string;
  name: string;
  preferredTransport: string;
  protocolVersion: string;
  skills: Array<{
    description: string;
    id: string;
    name: string;
    tags: Array<string>;
  }>;
  version: string;
}

interface A2AResponse {
  error?: {
    code: number;
    message: string;
  };
  id: string | number | null;
  jsonrpc: string;
  result?: {
    artifacts: Array<{
      artifactId: string;
      name: string;
      parts: Array<{ kind: string; text: string }>;
    }>;
  };
}

describe("serve() A2A server", () => {
  let server: ReturnType<typeof serve>;
  const testPort = 19_000;

  beforeAll(() => {
    server = serve(mockAgent, mockProvider, {
      description: "Test agent for A2A protocol",
      port: testPort,
      skills: ["greeting", "chat"],
    });
  });

  afterAll(() => {
    server.stop();
  });

  describe("GET /ping", () => {
    it("should return healthy status with timestamp", async () => {
      const res = await fetch(`http://localhost:${testPort}/ping`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as PingResponse;
      expect(body.status).toBe("Healthy");
      expect(typeof body.time_of_last_update).toBe("number");
      expect(body.time_of_last_update).toBeGreaterThan(0);
    });
  });

  describe("GET /.well-known/agent-card.json", () => {
    it("should return agent card with correct structure", async () => {
      const res = await fetch(`http://localhost:${testPort}/.well-known/agent-card.json`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as AgentCard;
      expect(body.name).toBe("test-agent");
      expect(body.description).toBe("Test agent for A2A protocol");
      expect(body.version).toBe("1.0.0");
      expect(body.protocolVersion).toBe("0.3.0");
      expect(body.preferredTransport).toBe("JSONRPC");
      expect(body.capabilities).toEqual({ streaming: false });
      expect(body.defaultInputModes).toEqual(["text"]);
      expect(body.defaultOutputModes).toEqual(["text"]);
      expect(Array.isArray(body.skills)).toBe(true);
      expect(body.skills).toHaveLength(2);
      expect(body.skills[0]).toEqual({
        description: "greeting",
        id: "skill-0",
        name: "greeting",
        tags: [],
      });
    });

    it("should return agent card with default description when not provided", async () => {
      const tempServer = serve(mockAgent, mockProvider, { port: 19_005 });

      try {
        const res = await fetch(`http://localhost:19005/.well-known/agent-card.json`);
        const body = (await res.json()) as AgentCard;
        expect(body.description).toBe("test-agent agent");
      } finally {
        tempServer.stop();
      }
    });
  });

  describe("POST / (JSON-RPC 2.0)", () => {
    it("should handle message/send method and return artifacts", async () => {
      const request = {
        id: "req-001",
        jsonrpc: "2.0" as const,
        method: "message/send",
        params: {
          message: {
            messageId: "msg-001",
            parts: [{ kind: "text", text: "Hello, agent!" }],
            role: "user",
          },
        },
      };

      const res = await fetch(`http://localhost:${testPort}/`, {
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(200);

      const body = (await res.json()) as A2AResponse;
      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBe("req-001");
      expect(body.result).toBeDefined();
      expect(body.result?.artifacts).toBeDefined();
      expect(body.result?.artifacts).toHaveLength(1);
      expect(body.result?.artifacts[0].name).toBe("agent_response");
      expect(body.result?.artifacts[0].parts).toHaveLength(1);
      expect(body.result?.artifacts[0].parts[0].kind).toBe("text");
      expect(body.result?.artifacts[0].parts[0].text).toBe("Response to: Hello, agent!");
    });

    it("should handle empty text input gracefully", async () => {
      const request = {
        id: "req-002",
        jsonrpc: "2.0" as const,
        method: "message/send",
        params: {
          message: {
            messageId: "msg-002",
            parts: [{ kind: "text", text: "" }],
            role: "user",
          },
        },
      };

      const res = await fetch(`http://localhost:${testPort}/`, {
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(200);

      const body = (await res.json()) as A2AResponse;
      expect(body.result?.artifacts[0].parts[0].text).toBe("Response to: ");
    });

    it("should handle missing parts gracefully", async () => {
      const request = {
        id: "req-003",
        jsonrpc: "2.0" as const,
        method: "message/send",
        params: {
          message: {
            messageId: "msg-003",
            parts: [],
            role: "user",
          },
        },
      };

      const res = await fetch(`http://localhost:${testPort}/`, {
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(200);

      const body = (await res.json()) as A2AResponse;
      expect(body.result?.artifacts[0].parts[0].text).toBe("Response to: ");
    });

    it("should return JSON-RPC error for unknown method", async () => {
      const request = {
        id: "req-004",
        jsonrpc: "2.0" as const,
        method: "unknown/method",
        params: {},
      };

      const res = await fetch(`http://localhost:${testPort}/`, {
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(400);

      const body = (await res.json()) as A2AResponse;
      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBe("req-004");
      expect(body.error).toBeDefined();
      expect(body.error?.code).toBe(-32_601);
      expect(body.error?.message).toBe("Method not found");
    });

    it("should return JSON-RPC error for invalid JSON", async () => {
      const res = await fetch(`http://localhost:${testPort}/`, {
        body: "not valid json",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(400);

      const body = (await res.json()) as A2AResponse;
      expect(body.jsonrpc).toBe("2.0");
      expect(body.error).toBeDefined();
      expect(body.error?.code).toBe(-32_700);
      expect(body.error?.message).toBe("Parse error");
    });
  });

  describe("POST / message/stream (SSE)", () => {
    async function collectSSE(
      port: number,
      body: unknown
    ): Promise<Array<Record<string, unknown>>> {
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
        .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);
    }

    it("should return SSE with task(working) → artifactUpdates → task(completed)", async () => {
      const events = await collectSSE(testPort, {
        id: "stream-1",
        jsonrpc: "2.0",
        method: "message/stream",
        params: { message: { parts: [{ kind: "text", text: "hi" }], role: "user" } },
      });

      expect(events.length).toBeGreaterThanOrEqual(3);

      const first = events[0] as {
        id: string;
        jsonrpc: string;
        result: { task: { status: { state: string }; taskId: string } };
      };
      expect(first.jsonrpc).toBe("2.0");
      expect(first.id).toBe("stream-1");
      expect(first.result.task.status.state).toBe("working");
      const taskId = first.result.task.taskId;

      const artifacts = events.slice(1, -1) as Array<any>;
      expect(artifacts.length).toBe(2);
      expect(artifacts[0].result.artifactUpdate.taskId).toBe(taskId);
      expect(artifacts[0].result.artifactUpdate.artifact.parts[0].text).toBe("Hello ");
      expect(artifacts[1].result.artifactUpdate.artifact.parts[0].text).toBe("World");

      const last = events.at(-1) as {
        result: { task: { status: { state: string }; taskId: string } };
      };
      expect(last.result.task.taskId).toBe(taskId);
      expect(last.result.task.status.state).toBe("completed");
    });

    it("should send task(failed) on agent error during stream", async () => {
      const failServer = serve(mockFailingAgent, mockProvider, { port: 19_006 });
      try {
        const events = await collectSSE(19_006, {
          id: "stream-err",
          jsonrpc: "2.0",
          method: "message/stream",
          params: { message: { parts: [{ kind: "text", text: "boom" }], role: "user" } },
        });

        expect(events.length).toBe(2);

        const first = events[0] as { result: { task: { status: { state: string } } } };
        expect(first.result.task.status.state).toBe("working");

        const last = events[1] as {
          result: { task: { status: { error: string; state: string } } };
        };
        expect(last.result.task.status.state).toBe("failed");
        expect(last.result.task.status.error).toBe("agent exploded");
      } finally {
        failServer.stop();
      }
    });

    it("should preserve request id in all SSE events", async () => {
      const events = await collectSSE(testPort, {
        id: 42,
        jsonrpc: "2.0",
        method: "message/stream",
        params: { message: { parts: [{ kind: "text", text: "test" }], role: "user" } },
      });

      for (const evt of events) {
        expect(evt.id).toBe(42);
        expect(evt.jsonrpc).toBe("2.0");
      }
    });

    it("should handle empty parts gracefully", async () => {
      const events = await collectSSE(testPort, {
        id: "stream-empty",
        jsonrpc: "2.0",
        method: "message/stream",
        params: { message: { parts: [], role: "user" } },
      });

      const first = events[0] as { result: { task: { status: { state: string } } } };
      expect(first.result.task.status.state).toBe("working");
      const last = events.at(-1) as { result: { task: { status: { state: string } } } };
      expect(last.result.task.status.state).toBe("completed");
    });
  });

  describe("404 handling", () => {
    it("should return 404 for unknown paths", async () => {
      const res = await fetch(`http://localhost:${testPort}/unknown-path`);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not Found");
    });

    it("should return 404 for wrong methods", async () => {
      const res = await fetch(`http://localhost:${testPort}/ping`, {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });
  });
});

describe("serve() port configuration", () => {
  it("should use opts.port when provided", () => {
    const server = serve(mockAgent, mockProvider, { port: 19_002 });
    expect(server.port).toBe(19_002);
    server.stop();
  });

  it("should use PORT env var when opts.port not provided", () => {
    const originalPort = process.env.PORT;
    process.env.PORT = "19003";

    try {
      const server = serve(mockAgent, mockProvider);
      expect(server.port).toBe(19_003);
      server.stop();
    } finally {
      if (originalPort !== undefined) {
        process.env.PORT = originalPort;
      } else {
        delete process.env.PORT;
      }
    }
  });

  it("should default to 9000 when no port specified", () => {
    const originalPort = process.env.PORT;
    delete process.env.PORT;

    try {
      const server = serve(mockAgent, mockProvider);
      expect(server.port).toBe(9000);
      server.stop();
    } finally {
      if (originalPort !== undefined) {
        process.env.PORT = originalPort;
      }
    }
  });
});
