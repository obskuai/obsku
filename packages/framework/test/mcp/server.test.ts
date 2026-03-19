import { describe, expect, mock, test } from "bun:test";
import { z } from "zod";

interface ServerConfig {
  name: string;
  version: string;
}
let capturedServerConfig: ServerConfig | undefined;
let serverConnectCount = 0;
let serverCloseCount = 0;
let transportCloseCount = 0;
let capturedTransportType: "stdio" | "http" | null = null;
let capturedHttpPort: number | null = null;
let _capturedTransportConfig: Record<string, unknown> | undefined;
let registeredTools: Array<{ handler: Function; name: string; schema: object }> = [];
let clientCloseCount = 0;
let listToolsCount = 0;
const _callToolArgs: Array<Record<string, unknown>> = [];
let _capturedHttpTransportConfig: Record<string, unknown> | undefined;

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

mock.module("@modelcontextprotocol/sdk", () => ({
  Client: class MockClient {
    async connect() {
      clientConnectCount++;
    }
    async listTools() {
      listToolsCount++;
      return listToolsResult;
    }
    async callTool(args: Record<string, unknown>) {
      return { args, ok: true };
    }
    async close() {
      clientCloseCount++;
    }
  },
  McpServer: class MockMcpServer {
    constructor(config: ServerConfig) {
      capturedServerConfig = config;
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
  StdioClientTransport: class MockClientTransport {
    constructor(_config: Record<string, unknown>) {}
    async close() {
      closeTransportCount++;
    }
  },
  StdioServerTransport: class MockStdioTransport {
    async close() {
      transportCloseCount++;
    }
  },
  StreamableHTTPClientTransport: class MockClientHttpTransport {
    constructor(_config: Record<string, unknown>) {}
    async close() {
      httpTransportCloseCount++;
    }
  },
  StreamableHTTPServerTransport: class MockHttpTransport {
    constructor(opts: { port: number }) {
      capturedTransportType = "http";
      capturedHttpPort = opts.port;
    }
    async close() {
      transportCloseCount++;
    }
  },
}));

function resetCaptures() {
  capturedServerConfig = undefined;
  registeredTools = [];
  serverConnectCount = 0;
  serverCloseCount = 0;
  transportCloseCount = 0;
  capturedTransportType = null;
  capturedHttpPort = null;
}

const mockPlugin = {
  description: "Echo tool",
  name: "echo",
  params: z.object({
    text: z.string().describe("Text to echo"),
    times: z.number().optional().describe("Number of times"),
  }),
  run: async ({ text, times }: { text: string; times?: number }) => {
    const t = times ?? 1;
    return Array(t).fill(text).join(" ");
  },
};

const mockPluginOptional = {
  description: "Greeting tool",
  name: "greet",
  params: z.object({
    greeting: z.string().optional(),
    name: z.string(),
  }),
  run: async ({ greeting, name }: { greeting?: string; name: string }) => {
    return `${greeting ?? "Hello"}, ${name}!`;
  },
};

describe("createMcpServer", () => {
  test("returns handle with start and close methods", async () => {
    resetCaptures();
    const { createMcpServer } = await import("../../src/mcp/server");
    const handle = await createMcpServer({
      name: "test-server",
      tools: [],
      version: "1.0.0",
    });

    expect(handle).toHaveProperty("start");
    expect(handle).toHaveProperty("close");
    expect(typeof handle.start).toBe("function");
    expect(typeof handle.close).toBe("function");
  });

  test("creates server with correct name and version", async () => {
    resetCaptures();
    const { createMcpServer } = await import("../../src/mcp/server");
    await createMcpServer({
      name: "my-mcp-server",
      tools: [],
      version: "2.1.0",
    });

    expect(capturedServerConfig).toEqual({
      name: "my-mcp-server",
      version: "2.1.0",
    });
  });

  test("registers tools with correct schema", async () => {
    resetCaptures();
    const { createMcpServer } = await import("../../src/mcp/server");
    await createMcpServer({
      name: "test-server",
      tools: [mockPlugin],
      version: "1.0.0",
    });

    expect(registeredTools).toHaveLength(1);
    expect(registeredTools[0].name).toBe("echo");
    const schema = registeredTools[0].schema as Record<string, unknown>;
    expect(schema.properties).toHaveProperty("text");
    expect(schema.properties).toHaveProperty("times");
    expect(schema.required).toEqual(["text"]);
    expect(schema.type).toBe("object");
  });
});

test("registers multiple tools", async () => {
  resetCaptures();
  const { createMcpServer } = await import("../../src/mcp/server");
  await createMcpServer({
    name: "test-server",
    tools: [mockPlugin, mockPluginOptional],
    version: "1.0.0",
  });

  expect(registeredTools).toHaveLength(2);
  expect(registeredTools[0].name).toBe("echo");
  expect(registeredTools[1].name).toBe("greet");
});

test("handles optional params correctly", async () => {
  resetCaptures();
  const { createMcpServer } = await import("../../src/mcp/server");
  await createMcpServer({
    name: "test-server",
    tools: [mockPluginOptional],
    version: "1.0.0",
  });

  const schema = registeredTools[0].schema as Record<string, unknown>;
  expect(schema.required).toEqual(["name"]);
  expect(schema.properties).toHaveProperty("greeting");
});

test("tool handler calls PluginDef.run and returns text content", async () => {
  resetCaptures();
  const { createMcpServer } = await import("../../src/mcp/server");
  await createMcpServer({
    name: "test-server",
    tools: [mockPlugin],
    version: "1.0.0",
  });

  const handler = registeredTools[0].handler;
  const result = await handler({ text: "hello", times: 2 });

  expect(result).toEqual({
    content: [{ text: "hello hello", type: "text" }],
  });
});

test("tool handler serializes non-string results", async () => {
  resetCaptures();
  const pluginWithObjectResult = {
    description: "Returns object",
    name: "getData",
    params: z.object({}),
    run: async () => ({ foo: "bar", num: 42 }),
  };

  const { createMcpServer } = await import("../../src/mcp/server");
  await createMcpServer({
    name: "test-server",
    tools: [pluginWithObjectResult],
    version: "1.0.0",
  });

  const handler = registeredTools[0].handler;
  const result = await handler({});

  expect(result).toEqual({
    content: [{ text: '{"foo":"bar","num":42}', type: "text" }],
  });
});

test("uses stdio transport by default", async () => {
  resetCaptures();
  const { createMcpServer } = await import("../../src/mcp/server");
  const handle = await createMcpServer({
    name: "test-server",
    tools: [],
    version: "1.0.0",
  });

  await handle.start();

  expect(capturedTransportType).toBeNull();
  expect(serverConnectCount).toBe(1);
});

test("uses http transport when configured", async () => {
  resetCaptures();
  const { createMcpServer } = await import("../../src/mcp/server");
  const handle = await createMcpServer({
    name: "test-server",
    port: 8080,
    tools: [],
    transport: "streamable-http",
    version: "1.0.0",
  });

  await handle.start();

  expect(capturedTransportType).toBe("http");
  expect(capturedHttpPort).toBe(8080);
  expect(serverConnectCount).toBe(1);
});

test("uses default port 3000 for http transport", async () => {
  resetCaptures();
  const { createMcpServer } = await import("../../src/mcp/server");
  const handle = await createMcpServer({
    name: "test-server",
    tools: [],
    transport: "streamable-http",
    version: "1.0.0",
  });

  await handle.start();

  expect(capturedHttpPort).toBe(3000);
});

test("start connects server to transport", async () => {
  resetCaptures();
  const { createMcpServer } = await import("../../src/mcp/server");
  const handle = await createMcpServer({
    name: "test-server",
    tools: [],
    version: "1.0.0",
  });

  await handle.start();

  expect(serverConnectCount).toBe(1);
});

test("close cleans up server and transport", async () => {
  resetCaptures();
  const { createMcpServer } = await import("../../src/mcp/server");
  const handle = await createMcpServer({
    name: "test-server",
    tools: [],
    version: "1.0.0",
  });

  await handle.start();
  await handle.close();

  expect(serverCloseCount).toBe(1);
  expect(transportCloseCount).toBe(1);
});

test("handles empty tools array", async () => {
  resetCaptures();
  const { createMcpServer } = await import("../../src/mcp/server");
  await createMcpServer({
    name: "test-server",
    tools: [],
    version: "1.0.0",
  });

  expect(registeredTools).toHaveLength(0);
});

test("handles plugin with no params", async () => {
  resetCaptures();
  const pluginNoParams = {
    description: "Ping tool",
    name: "ping",
    params: z.object({}),
    run: async () => "pong",
  };

  const { createMcpServer } = await import("../../src/mcp/server");
  await createMcpServer({
    name: "test-server",
    tools: [pluginNoParams],
    version: "1.0.0",
  });

  expect(registeredTools).toHaveLength(1);

  const handler = registeredTools[0].handler;
  const result = await handler({});
  expect(result).toEqual({
    content: [{ text: "pong", type: "text" }],
  });
});
