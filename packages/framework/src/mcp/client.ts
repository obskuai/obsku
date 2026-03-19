import type { McpCallToolResult, McpProvider, ToolDef } from "../types";
import { formatError } from "../utils";
import { McpConfigError, McpSdkLoadError } from "./errors";
import type { McpServerConfig } from "./types";

type Transport = {
  close: () => Promise<void>;
};

type McpSdkModule = {
  Client: new (opts: {
    transport: unknown;
  }) => {
    callTool: (args: { arguments?: Record<string, unknown>; name: string }) => Promise<unknown>;
    close: () => Promise<void>;
    connect: () => Promise<void>;
    listTools: () => Promise<{
      tools: Array<{ description?: string; inputSchema: Record<string, unknown>; name: string }>;
    }>;
  };
  StdioClientTransport: new (opts: {
    args?: Array<string>;
    command: string;
    env?: Record<string, string>;
  }) => Transport;
  StreamableHTTPClientTransport: new (opts: { url: string | URL }) => Transport;
};

async function loadMcpSdk(): Promise<McpSdkModule> {
  try {
    const mod = await import("@modelcontextprotocol/sdk" as string);
    return mod as McpSdkModule;
  } catch (error: unknown) {
    throw new McpSdkLoadError(formatError(error));
  }
}

export async function createMcpClient(config: McpServerConfig): Promise<McpProvider> {
  const { Client, StdioClientTransport, StreamableHTTPClientTransport } = await loadMcpSdk();

  const transportType = config.transport ?? "stdio";

  let transport: Transport;
  if (transportType === "streamable-http") {
    if (!config.url) {
      throw new McpConfigError("URL required for streamable-http transport");
    }
    transport = new StreamableHTTPClientTransport({ url: config.url });
  } else {
    transport = new StdioClientTransport({
      args: config.args,
      command: config.command,
      env: config.env,
    });
  }

  const client = new Client({ transport });

  return {
    callTool: async (name: string, input: Record<string, unknown>): Promise<McpCallToolResult> => {
      return client.callTool({ arguments: input, name }) as Promise<McpCallToolResult>;
    },
    close: async () => {
      await client.close();
      await transport.close();
    },
    connect: async () => {
      await client.connect();
    },
    listTools: async (): Promise<Array<ToolDef>> => {
      const result = await client.listTools();
      return (result.tools ?? []).map((tool) => ({
        description: tool.description ?? "",
        inputSchema: tool.inputSchema as ToolDef["inputSchema"],
        name: tool.name,
      }));
    },
  };
}
