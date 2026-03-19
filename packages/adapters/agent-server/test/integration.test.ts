import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { LLMProvider, LLMResponse, LLMStreamEvent, Message, ToolDef } from "@obsku/framework";
import { agent, asRemoteAgent } from "@obsku/framework";
import { serve } from "../src/index";

const PORT = 0;
let baseUrl = "";
let server: ReturnType<typeof Bun.serve> | undefined;

async function waitForHealthy(url: string, maxRetries = 30, intervalMs = 200) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${url}/ping`);
      if (res.ok) {
        return;
      }
    } catch {
      // server not ready yet; retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Server at ${url} did not become healthy after ${maxRetries} retries`);
}

interface A2AResponse {
  error?: { code: number; message: string };
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

interface PingResponse {
  status: string;
  time_of_last_update: number;
}

beforeAll(async () => {
  const provider: LLMProvider = {
    contextWindowSize: 8192,
    async chat(): Promise<LLMResponse> {
      return {
        content: [{ text: "mock response", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
    async *chatStream(): AsyncIterable<LLMStreamEvent> {
      yield { content: "mock", type: "text_delta" };
      yield {
        stopReason: "end_turn",
        type: "message_end",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };

  const testAgent = {
    name: "integration-test-agent",
    run: async (input: string, _provider: LLMProvider): Promise<string> => {
      return `[integration-test] ${input}`;
    },
  };

  server = serve(testAgent, provider, {
    description: "Integration test agent for Docker-based A2A testing",
    port: PORT,
    skills: ["test", "echo"],
  });
  baseUrl = `http://127.0.0.1:${server.port}`;

  try {
    await waitForHealthy(baseUrl);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}, 15_000);

afterAll(async () => {
  if (!server) {
    return;
  }

  server.stop();
  server = undefined;
  baseUrl = "";
});

describe("Docker A2A Integration", () => {
  describe("container health", () => {
    it("GET /ping returns Healthy", async () => {
      const res = await fetch(`${baseUrl}/ping`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as PingResponse;
      expect(body.status).toBe("Healthy");
      expect(typeof body.time_of_last_update).toBe("number");
    });

    it("GET /.well-known/agent-card.json returns valid card", async () => {
      const res = await fetch(`${baseUrl}/.well-known/agent-card.json`);
      expect(res.status).toBe(200);

      const card = (await res.json()) as Record<string, unknown>;
      expect(card.name).toBe("integration-test-agent");
      expect(card.protocolVersion).toBe("0.3.0");
      expect(Array.isArray(card.skills)).toBe(true);
    });
  });

  describe("asRemoteAgent round-trip", () => {
    it("sends A2A request and extracts response text", async () => {
      const remotePlugin = asRemoteAgent("docker-agent", { url: baseUrl });

      const mockCtx = {
        exec: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
        fetch,
        logger: { debug() {}, error() {}, info() {}, warn() {} },
        signal: AbortSignal.timeout(30_000),
      };

      const result = await remotePlugin.run({ task: "hello from test" }, mockCtx);
      expect(result).toBe("[integration-test] hello from test");
    });

    it("handles empty input gracefully", async () => {
      const remotePlugin = asRemoteAgent("docker-agent", { url: baseUrl });

      const mockCtx = {
        exec: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
        fetch,
        logger: { debug() {}, error() {}, info() {}, warn() {} },
        signal: AbortSignal.timeout(30_000),
      };

      const result = await remotePlugin.run({ task: "" }, mockCtx);
      expect(result).toBe("[integration-test] ");
    });
  });

  describe("coordinator agent full delegation chain", () => {
    it("agent with asRemoteAgent tool completes full loop", async () => {
      const remotePlugin = asRemoteAgent("docker-agent", { url: baseUrl });

      let callCount = 0;

      const coordinatorProvider: LLMProvider = {
        async chat(_messages: Array<Message>, tools?: Array<ToolDef>): Promise<LLMResponse> {
          callCount++;

          if (callCount === 1 && tools && tools.length > 0) {
            return {
              content: [
                {
                  input: { task: "delegated task from coordinator" },
                  name: "docker-agent",
                  toolUseId: "call-001",
                  type: "tool_use",
                },
              ],
              stopReason: "tool_use",
              usage: { inputTokens: 50, outputTokens: 20 },
            };
          }

          return {
            content: [
              {
                text: "Coordinator received remote agent result successfully.",
                type: "text",
              },
            ],
            stopReason: "end_turn",
            usage: { inputTokens: 100, outputTokens: 30 },
          };
        },
        async *chatStream(): AsyncIterable<LLMStreamEvent> {
          yield {
            content: "stream not used in this test",
            type: "text_delta",
          };
          yield {
            stopReason: "end_turn",
            type: "message_end",
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        },
        contextWindowSize: 8192,
      };

      const coordinator = agent({
        name: "coordinator",
        prompt: "You coordinate tasks by delegating to remote agents.",
        tools: [remotePlugin],
      });

      const result = await coordinator.run(
        "Delegate this to the remote agent",
        coordinatorProvider
      );

      expect(callCount).toBe(2);
      expect(result).toBe("Coordinator received remote agent result successfully.");
    });
  });

  describe("raw A2A JSON-RPC", () => {
    it("message/send returns valid JSON-RPC response", async () => {
      const request = {
        id: "integration-001",
        jsonrpc: "2.0",
        method: "message/send",
        params: {
          message: {
            messageId: "msg-int-001",
            parts: [{ kind: "text", text: "raw JSON-RPC test" }],
            role: "user",
          },
        },
      };

      const res = await fetch(baseUrl, {
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      expect(res.status).toBe(200);

      const body = (await res.json()) as A2AResponse;
      expect(body.jsonrpc).toBe("2.0");
      expect(body.id).toBe("integration-001");
      expect(body.result).toBeDefined();
      expect(body.result?.artifacts).toHaveLength(1);
      expect(body.result?.artifacts[0].parts[0].kind).toBe("text");
      expect(body.result?.artifacts[0].parts[0].text).toBe("[integration-test] raw JSON-RPC test");
    });

    it("unknown method returns -32601 error", async () => {
      const request = {
        id: "integration-002",
        jsonrpc: "2.0",
        method: "unknown/method",
        params: {},
      };

      const res = await fetch(baseUrl, {
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const body = (await res.json()) as A2AResponse;
      expect(body.error).toBeDefined();
      expect(body.error?.code).toBe(-32_601);
    });
  });
});
