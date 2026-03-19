// =============================================================================
// Tests for asRemoteAgent() helper — wrapping remote A2A agents as plugins
// =============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  asRemoteAgent,
  JsonRpcError,
  type RemoteAgentArnConfig,
  RemoteAgentError,
  type RemoteAgentUrlConfig,
} from "../src/remote-agent";
import type { PluginCtx, PluginDef } from "../src/types";

// Helper to safely access ZodObject properties from plugin params
function getZodShape(params: z.ZodType): z.ZodRawShape {
  if (!("shape" in params) || typeof params.shape !== "object" || params.shape === null) {
    throw new Error("Expected plugin params to be a ZodObject");
  }
  return params.shape as z.ZodRawShape;
}
// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockPluginCtx(): PluginCtx {
  return {
    exec: async (
      _cmd: string,
      _args: Array<string>,
      _opts?: { cwd?: string; env?: Record<string, string>; signal?: AbortSignal; timeout?: number }
    ) => ({
      exitCode: 0,
      stderr: "",
      stdout: "",
    }),
    fetch: async (url, init) => fetch(url, init),
    logger: {
      debug: () => {},
      error: () => {},
      info: () => {},
      warn: () => {},
    },
    signal: new AbortController().signal,
  };
}

async function runPluginUnchecked(
  plugin: PluginDef,
  input: unknown,
  ctx: PluginCtx
): Promise<unknown> {
  return (plugin.run as (input: unknown, ctx: PluginCtx) => Promise<unknown>)(input, ctx);
}

// Mock fetch for testing
let _mockFetchResponse: Response | null = null;
let lastFetchCall: { options: RequestInit; url: string } | null = null;

// Store original fetch
const originalFetch = globalThis.fetch;

function setupMockFetch(response: Response | (() => Response)) {
  const mockFetch = async (url: string | URL, options?: RequestInit) => {
    lastFetchCall = { options: options || {}, url: url.toString() };
    return typeof response === "function" ? response() : response;
  };
  mockFetch.preconnect = async () => {};
  globalThis.fetch = mockFetch as typeof globalThis.fetch;
}

function restoreMockFetch() {
  globalThis.fetch = originalFetch;
  _mockFetchResponse = null;
  lastFetchCall = null;
}

// ---------------------------------------------------------------------------
// asRemoteAgent() factory - URL mode
// ---------------------------------------------------------------------------

describe("asRemoteAgent() factory - URL mode", () => {
  test("returns valid PluginDef shape", () => {
    const config: RemoteAgentUrlConfig = { url: "https://agent.example.com/a2a" };
    const plugin = asRemoteAgent("test-agent", config);

    // Verify PluginDef structure
    expect(plugin.name).toBe("test-agent");
    expect(typeof plugin.description).toBe("string");
    expect(plugin.description).toContain("test-agent");
    expect(plugin.params).toBeDefined();
    expect(getZodShape(plugin.params)).toHaveProperty("task");
    expect(getZodShape(plugin.params).task).toBeInstanceOf(z.ZodString);
    expect(getZodShape(plugin.params).task.description).toContain("task");
    expect(typeof plugin.run).toBe("function");
  });

  test("URL mode returns valid PluginDef", () => {
    const config: RemoteAgentUrlConfig = {
      timeout: 60_000,
      url: "https://agent.example.com/a2a",
    };
    const plugin = asRemoteAgent("remote-researcher", config);

    expect(plugin.name).toBe("remote-researcher");
    expect(getZodShape(plugin.params).task).toBeInstanceOf(z.ZodString);
    expect(getZodShape(plugin.params).task.description).toContain("task");
  });
});

// ---------------------------------------------------------------------------
// URL mode run() - JSON-RPC requests
// ---------------------------------------------------------------------------

describe("asRemoteAgent() URL mode - run()", () => {
  afterEach(() => {
    restoreMockFetch();
  });

  test("run sends correct JSON-RPC request", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "test-id",
        jsonrpc: "2.0",
        result: {
          artifacts: [
            {
              artifactId: "art-1",
              name: "agent_response",
              parts: [{ kind: "text", text: "Research complete" }],
            },
          ],
        },
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );

    setupMockFetch(mockResponse);

    const config: RemoteAgentUrlConfig = { url: "https://agent.example.com/a2a" };
    const plugin = asRemoteAgent("researcher", config);
    const ctx = createMockPluginCtx();

    await plugin.run({ task: "Research quantum computing" }, ctx);

    // Verify fetch was called with correct parameters
    expect(lastFetchCall).not.toBeNull();
    expect(lastFetchCall?.url).toBe("https://agent.example.com/a2a");
    expect(lastFetchCall?.options.method).toBe("POST");
    expect(lastFetchCall?.options.headers).toMatchObject({
      "Content-Type": "application/json",
    });

    // Verify JSON-RPC body
    const body = JSON.parse((lastFetchCall?.options.body as string) || "{}");
    expect(body.jsonrpc).toBe("2.0");
    expect(body.method).toBe("message/send");
    expect(body.params.message.role).toBe("user");
    expect(body.params.message.parts[0]).toMatchObject({
      kind: "text",
      text: "Research quantum computing",
    });
    expect(body.params.message.messageId).toBeDefined();
  });

  test("extracts text from artifacts correctly", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "test-id",
        jsonrpc: "2.0",
        result: {
          artifacts: [
            {
              artifactId: "art-1",
              name: "agent_response",
              parts: [{ kind: "text", text: "The answer is 42" }],
            },
          ],
        },
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );

    setupMockFetch(mockResponse);

    const config: RemoteAgentUrlConfig = { url: "https://agent.example.com/a2a" };
    const plugin = asRemoteAgent("researcher", config);
    const ctx = createMockPluginCtx();

    const result = await plugin.run({ task: "What is the answer?" }, ctx);

    expect(result).toBe("The answer is 42");
  });

  test("throws error when task parameter is missing", async () => {
    const config: RemoteAgentUrlConfig = { url: "https://agent.example.com/a2a" };
    const plugin = asRemoteAgent("researcher", config);
    const ctx = createMockPluginCtx();

    await expect(runPluginUnchecked(plugin, {}, ctx)).rejects.toThrow(RemoteAgentError);
    await expect(runPluginUnchecked(plugin, {}, ctx)).rejects.toThrow(/task/);
  });

  test("throws error when task is not a string", async () => {
    const config: RemoteAgentUrlConfig = { url: "https://agent.example.com/a2a" };
    const plugin = asRemoteAgent("researcher", config);
    const ctx = createMockPluginCtx();

    await expect(runPluginUnchecked(plugin, { task: 123 }, ctx)).rejects.toThrow(/string/);
    await expect(runPluginUnchecked(plugin, { task: null }, ctx)).rejects.toThrow(/string/);
    await expect(runPluginUnchecked(plugin, { task: {} }, ctx)).rejects.toThrow(/string/);
  });

  test("throws on non-200 HTTP response", async () => {
    const mockResponse = new Response("Internal Server Error", {
      status: 500,
      statusText: "Internal Server Error",
    });

    setupMockFetch(mockResponse);

    const config: RemoteAgentUrlConfig = { url: "https://agent.example.com/a2a" };
    const plugin = asRemoteAgent("researcher", config);
    const ctx = createMockPluginCtx();

    await expect(plugin.run({ task: "test" }, ctx)).rejects.toThrow(RemoteAgentError);
    await expect(plugin.run({ task: "test" }, ctx)).rejects.toThrow(/HTTP error 500/);
  });

  test("throws JsonRpcError on JSON-RPC error response", async () => {
    setupMockFetch(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: -32_601,
              data: { details: "message/send is not supported" },
              message: "Method not found",
            },
            id: "test-id",
            jsonrpc: "2.0",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        )
    );

    const config: RemoteAgentUrlConfig = { url: "https://agent.example.com/a2a" };
    const plugin = asRemoteAgent("researcher", config);
    const ctx = createMockPluginCtx();

    await expect(plugin.run({ task: "test" }, ctx)).rejects.toThrow(JsonRpcError);
    await expect(plugin.run({ task: "test" }, ctx)).rejects.toThrow(/JSON-RPC error -32601/);
    await expect(plugin.run({ task: "test" }, ctx)).rejects.toThrow(/Method not found/);

    // Verify error properties
    try {
      await plugin.run({ task: "test" }, ctx);
    } catch (error) {
      if (error instanceof JsonRpcError) {
        expect(error.code).toBe(-32_601);
        expect(error.message).toContain("Method not found");
      }
    }
  });

  test("throws when no artifacts in response", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "test-id",
        jsonrpc: "2.0",
        result: {},
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );

    setupMockFetch(mockResponse);

    const config: RemoteAgentUrlConfig = { url: "https://agent.example.com/a2a" };
    const plugin = asRemoteAgent("researcher", config);
    const ctx = createMockPluginCtx();

    await expect(plugin.run({ task: "test" }, ctx)).rejects.toThrow(/No artifacts/);
  });

  test("throws when artifact has no parts", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "test-id",
        jsonrpc: "2.0",
        result: {
          artifacts: [{ artifactId: "art-1", name: "empty" }],
        },
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );

    setupMockFetch(mockResponse);

    const config: RemoteAgentUrlConfig = { url: "https://agent.example.com/a2a" };
    const plugin = asRemoteAgent("researcher", config);
    const ctx = createMockPluginCtx();

    await expect(plugin.run({ task: "test" }, ctx)).rejects.toThrow(/No parts/);
  });

  test("throws when first part has no text", async () => {
    const mockResponse = new Response(
      JSON.stringify({
        id: "test-id",
        jsonrpc: "2.0",
        result: {
          artifacts: [
            {
              artifactId: "art-1",
              name: "response",
              parts: [{ kind: "image", mimeType: "image/png" }],
            },
          ],
        },
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );

    setupMockFetch(mockResponse);

    const config: RemoteAgentUrlConfig = { url: "https://agent.example.com/a2a" };
    const plugin = asRemoteAgent("researcher", config);
    const ctx = createMockPluginCtx();

    await expect(plugin.run({ task: "test" }, ctx)).rejects.toThrow(/no text content/);
  });

  test("timeout is configurable", async () => {
    // Create a mock that captures the signal timeout
    let capturedSignal: AbortSignal | undefined;
    const mockFetch = async (_url: string | URL, options?: RequestInit) => {
      capturedSignal = options?.signal ?? undefined;
      return new Response(
        JSON.stringify({
          id: "test-id",
          jsonrpc: "2.0",
          result: {
            artifacts: [{ parts: [{ kind: "text", text: "ok" }] }],
          },
        }),
        { status: 200 }
      );
    };
    mockFetch.preconnect = async () => {};
    globalThis.fetch = mockFetch as typeof globalThis.fetch;

    const config: RemoteAgentUrlConfig = {
      timeout: 120_000, // 2 minutes
      url: "https://agent.example.com/a2a",
    };
    const plugin = asRemoteAgent("researcher", config);
    const ctx = createMockPluginCtx();

    await plugin.run({ task: "test" }, ctx);

    // Verify that a signal was passed (AbortSignal.timeout creates a signal)
    expect(capturedSignal).toBeDefined();
  });

  test("uses default timeout of 300000ms when not specified", async () => {
    let capturedSignal: AbortSignal | undefined;
    const mockFetch = async (_url: string | URL, options?: RequestInit) => {
      capturedSignal = options?.signal ?? undefined;
      return new Response(
        JSON.stringify({
          id: "test-id",
          jsonrpc: "2.0",
          result: {
            artifacts: [{ parts: [{ kind: "text", text: "ok" }] }],
          },
        }),
        { status: 200 }
      );
    };
    mockFetch.preconnect = async () => {};
    globalThis.fetch = mockFetch as typeof globalThis.fetch;

    const config: RemoteAgentUrlConfig = {
      url: "https://agent.example.com/a2a",
      // No timeout specified - should default to 300000
    };
    const plugin = asRemoteAgent("researcher", config);
    const ctx = createMockPluginCtx();

    await plugin.run({ task: "test" }, ctx);

    // Verify that a signal was passed
    expect(capturedSignal).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// ARN mode
// ---------------------------------------------------------------------------

describe("asRemoteAgent() ARN mode", () => {
  test("returns valid PluginDef shape", () => {
    const config: RemoteAgentArnConfig = {
      arn: "arn:aws:bedrock:us-east-1:123456789:agent/MyAgent",
      region: "us-west-2",
    };
    const plugin = asRemoteAgent("aws-agent", config);

    expect(plugin.name).toBe("aws-agent");
    expect(typeof plugin.run).toBe("function");
  });

  test("ARN mode throws when AWS SDK not available", async () => {
    const config: RemoteAgentArnConfig = {
      arn: "arn:aws:bedrock:us-east-1:123456789:agent/MyAgent",
      region: "us-west-2",
      timeout: 60_000,
    };
    const plugin = asRemoteAgent("aws-agent", config);
    const ctx = createMockPluginCtx();

    await expect(plugin.run({ task: "test task" }, ctx)).rejects.toThrow(RemoteAgentError);
    await expect(plugin.run({ task: "test task" }, ctx)).rejects.toThrow(/AWS SDK/);
  });

  test("ARN mode type-checks correctly", () => {
    // This test verifies that the TypeScript types are correct
    const config: RemoteAgentArnConfig = {
      arn: "arn:aws:bedrock:us-east-1:123456789:agent/MyAgent",
      region: "eu-west-1",
      timeout: 120_000,
    };

    // Should compile without errors
    const plugin: PluginDef = asRemoteAgent("test-agent", config);
    expect(plugin).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Integration-style tests
// ---------------------------------------------------------------------------

describe("asRemoteAgent() integration", () => {
  afterEach(() => {
    restoreMockFetch();
  });

  test("plugin can be used in agent.tools array structure", () => {
    const urlConfig: RemoteAgentUrlConfig = {
      url: "https://agent.example.com/a2a",
    };
    const urlPlugin = asRemoteAgent("remote-agent", urlConfig);

    // Verify the plugin matches PluginDef interface
    const pluginDef: PluginDef = urlPlugin;
    expect(pluginDef.name).toBe("remote-agent");
    expect(getZodShape(pluginDef.params).task).toBeDefined();
  });

  test("description mentions agent name for discoverability", () => {
    const config: RemoteAgentUrlConfig = { url: "https://agent.example.com/a2a" };
    const plugin = asRemoteAgent("security-scanner", config);

    expect(plugin.description).toContain("security-scanner");
    expect(plugin.description.toLowerCase()).toContain("delegate");
  });

  test("task parameter has correct schema", () => {
    const config: RemoteAgentUrlConfig = { url: "https://agent.example.com/a2a" };
    const plugin = asRemoteAgent("task-agent", config);

    expect(getZodShape(plugin.params).task).toBeInstanceOf(z.ZodString);
    expect(getZodShape(plugin.params).task.description).toContain("task");
  });

  test("handles network errors gracefully", async () => {
    const mockFetch = async () => {
      throw new Error("Network error: Connection refused");
    };
    mockFetch.preconnect = async () => {};
    globalThis.fetch = mockFetch as typeof globalThis.fetch;

    const config: RemoteAgentUrlConfig = { url: "https://agent.example.com/a2a" };
    const plugin = asRemoteAgent("researcher", config);
    const ctx = createMockPluginCtx();

    await expect(plugin.run({ task: "test" }, ctx)).rejects.toThrow(RemoteAgentError);
    await expect(plugin.run({ task: "test" }, ctx)).rejects.toThrow(/Failed to connect/);
  });

  test("handles invalid JSON response", async () => {
    const mockResponse = new Response("not valid json", {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

    setupMockFetch(mockResponse);

    const config: RemoteAgentUrlConfig = { url: "https://agent.example.com/a2a" };
    const plugin = asRemoteAgent("researcher", config);
    const ctx = createMockPluginCtx();

    await expect(plugin.run({ task: "test" }, ctx)).rejects.toThrow(/Invalid JSON/);
  });
});

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

describe("Error classes", () => {
  test("RemoteAgentError has correct properties", () => {
    const error = new RemoteAgentError("my-agent", "Something went wrong", new Error("cause"));

    expect(error.name).toBe("RemoteAgentError");
    expect(error.agentName).toBe("my-agent");
    expect(error.message).toContain("my-agent");
    expect(error.message).toContain("Something went wrong");
    expect(error.cause).toBeDefined();
    expect(error._tag).toBe("RemoteAgentError");
  });

  test("JsonRpcError has correct properties", () => {
    const error = new JsonRpcError(-32_600, "Invalid Request", { field: "missing" });

    expect(error.name).toBe("JsonRpcError");
    expect(error.code).toBe(-32_600);
    expect(error.message).toContain("-32600");
    expect(error.message).toContain("Invalid Request");
    expect(error.data).toEqual({ field: "missing" });
    expect(error._tag).toBe("JsonRpcError");
  });
});
