import { describe, expect, mock, test } from "bun:test";
import type { McpProvider } from "../../src/types";

let capturedTransportConfig: Record<string, unknown> | undefined;
let connectCount = 0;
let closeCount = 0;
let listToolsCount = 0;
let callToolArgs: Array<Record<string, unknown>> = [];
let closeTransportCount = 0;

const listToolsResult = {
  tools: [
    {
      description: "Search tool",
      inputSchema: {
        properties: { query: { type: "string" } },
        required: ["query"],
        type: "object",
      },
      name: "search",
    },
  ],
};

let capturedHttpTransportConfig: Record<string, unknown> | undefined;
let httpTransportCloseCount = 0;

let _capturedServerConfig: Record<string, unknown> | undefined;
const registeredTools: Array<{ handler: Function; name: string; schema: object }> = [];
let serverConnectCount = 0;
let serverCloseCount = 0;
let serverTransportCloseCount = 0;
let _capturedServerTransportType: "stdio" | "http" | null = null;
let _capturedServerHttpPort: number | null = null;

mock.module("@modelcontextprotocol/sdk", () => ({
  Client: class MockClient {
    async connect() {
      connectCount++;
    }
    async listTools() {
      listToolsCount++;
      return listToolsResult;
    }
    async callTool(args: Record<string, unknown>) {
      callToolArgs.push(args);
      return { args, ok: true };
    }
    async close() {
      closeCount++;
    }
  },
  McpServer: class MockMcpServer {
    constructor(config: Record<string, unknown>) {
      _capturedServerConfig = config;
    }
    registerTool(name: string, schema: object, handler: Function) {
      registeredTools.push({ handler, name, schema });
    }
    async connect(_transport: unknown) {
      serverConnectCount++;
    }
    async close() {
      serverCloseCount++;
    }
  },
  StdioClientTransport: class MockTransport {
    constructor(config: Record<string, unknown>) {
      capturedTransportConfig = config;
    }
    async close() {
      closeTransportCount++;
    }
  },
  StdioServerTransport: class MockStdioTransport {
    async close() {
      serverTransportCloseCount++;
    }
  },
  StreamableHTTPClientTransport: class MockHttpTransport {
    constructor(config: Record<string, unknown>) {
      capturedHttpTransportConfig = config;
    }
    async close() {
      httpTransportCloseCount++;
    }
  },
  StreamableHTTPServerTransport: class MockHttpTransport {
    constructor(opts: { port: number }) {
      _capturedServerTransportType = "http";
      _capturedServerHttpPort = opts.port;
    }
    async close() {
      serverTransportCloseCount++;
    }
  },
}));

function resetCaptures() {
  capturedTransportConfig = undefined;
  capturedHttpTransportConfig = undefined;
  connectCount = 0;
  closeCount = 0;
  listToolsCount = 0;
  callToolArgs = [];
  closeTransportCount = 0;
  httpTransportCloseCount = 0;
}

describe("createMcpClient", () => {
  test("returns object implementing McpProvider", async () => {
    resetCaptures();
    const { createMcpClient } = await import("../../src/mcp/client");
    const client: McpProvider = await createMcpClient({ command: "mcp-server" });

    expect(client).toHaveProperty("connect");
    expect(client).toHaveProperty("listTools");
    expect(client).toHaveProperty("callTool");
    expect(client).toHaveProperty("close");
  });

  test("connect initializes client", async () => {
    resetCaptures();
    const { createMcpClient } = await import("../../src/mcp/client");
    const client = await createMcpClient({
      args: ["--flag"],
      command: "mcp-server",
      env: { A: "b" },
    });

    await client.connect();

    expect(connectCount).toBe(1);
    expect(capturedTransportConfig).toMatchObject({
      args: ["--flag"],
      command: "mcp-server",
      env: { A: "b" },
    });
  });

  test("listTools returns ToolDef[]", async () => {
    resetCaptures();
    const { createMcpClient } = await import("../../src/mcp/client");
    const client = await createMcpClient({ command: "mcp-server" });

    const tools = await client.listTools();

    expect(listToolsCount).toBe(1);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      description: "Search tool",
      inputSchema: listToolsResult.tools[0].inputSchema,
      name: "search",
    });
  });

  test("callTool forwards name and input", async () => {
    resetCaptures();
    const { createMcpClient } = await import("../../src/mcp/client");
    const client = await createMcpClient({ command: "mcp-server" });

    const result = await client.callTool("search", { query: "hello" });

    expect(callToolArgs).toEqual([{ arguments: { query: "hello" }, name: "search" }]);
    expect(result).toMatchObject({ ok: true });
  });

  test("close cleans up client and transport", async () => {
    resetCaptures();
    const { createMcpClient } = await import("../../src/mcp/client");
    const client = await createMcpClient({ command: "mcp-server" });

    await client.close();

    expect(closeCount).toBe(1);
    expect(closeTransportCount).toBe(1);
  });

  test("streamable-http transport creates HTTP client", async () => {
    resetCaptures();
    const { createMcpClient } = await import("../../src/mcp/client");
    const client = await createMcpClient({
      command: "ignored",
      transport: "streamable-http",
      url: "http://localhost:3000/mcp",
    });

    expect(client).toHaveProperty("connect");
    expect(client).toHaveProperty("listTools");
    expect(client).toHaveProperty("callTool");
    expect(client).toHaveProperty("close");
    expect(capturedHttpTransportConfig).toMatchObject({
      url: "http://localhost:3000/mcp",
    });
  });

  test("streamable-http transport connects/lists/calls/closes", async () => {
    resetCaptures();
    const { createMcpClient } = await import("../../src/mcp/client");
    const client = await createMcpClient({
      command: "ignored",
      transport: "streamable-http",
      url: "http://localhost:3000/mcp",
    });

    await client.connect();
    expect(connectCount).toBe(1);

    const tools = await client.listTools();
    expect(listToolsCount).toBe(1);
    expect(tools).toHaveLength(1);

    const result = await client.callTool("search", { query: "hello" });
    expect(callToolArgs).toEqual([{ arguments: { query: "hello" }, name: "search" }]);
    expect(result).toMatchObject({ ok: true });

    await client.close();
    expect(closeCount).toBe(1);
    expect(httpTransportCloseCount).toBe(1);
  });

  test("streamable-http without url throws error", async () => {
    resetCaptures();
    const { createMcpClient } = await import("../../src/mcp/client");
    await expect(
      createMcpClient({
        command: "ignored",
        transport: "streamable-http",
      })
    ).rejects.toThrow("URL required for streamable-http transport");
  });

  test("default transport is stdio when not specified", async () => {
    resetCaptures();
    const { createMcpClient } = await import("../../src/mcp/client");
    const client = await createMcpClient({ command: "mcp-server" });

    await client.connect();
    expect(connectCount).toBe(1);
    expect(capturedTransportConfig).toMatchObject({
      command: "mcp-server",
    });
    expect(capturedHttpTransportConfig).toBeUndefined();
  });
});
