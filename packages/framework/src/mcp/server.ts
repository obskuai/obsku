import { z } from "zod";
import { DEFAULTS } from "../defaults";
import type { JsonSchema } from "../types/json-schema";
import type { PluginCtx, PluginDef } from "../types";
import { getErrorMessage } from "../utils";
import { McpSdkLoadError } from "./errors";
import type { McpHostServerConfig } from "./types";

type McpServerSdkModule = {
  McpServer: new (config: {
    name: string;
    version: string;
  }) => {
    close(): Promise<void>;
    connect(transport: unknown): Promise<void>;
    registerTool(
      name: string,
      schema: JsonSchema,
      handler: (
        args: Record<string, unknown>
      ) => Promise<{ content: Array<{ text: string; type: string }> }>
    ): void;
  };
  StdioServerTransport: new () => {
    close(): Promise<void>;
  };
  StreamableHTTPServerTransport: new (opts: {
    port: number;
  }) => {
    close(): Promise<void>;
  };
};

async function loadMcpServerSdk(): Promise<McpServerSdkModule> {
  try {
    const mod = await import("@modelcontextprotocol/sdk" as string);
    return mod as McpServerSdkModule;
  } catch (error: unknown) {
    throw new McpSdkLoadError(getErrorMessage(error));
  }
}

function pluginDefToMcpToolSchema(plugin: PluginDef): {
  description: string;
  inputSchema: JsonSchema;
  name: string;
} {
  return {
    description: plugin.description,
    inputSchema: z.toJSONSchema(plugin.params) as unknown as JsonSchema,
    name: plugin.name,
  };
}

function createMockPluginCtx(): PluginCtx {
  return {
    exec: async () => {
      throw new Error("exec() not available in MCP server context");
    },
    fetch: async () => {
      throw new Error("fetch() not available in MCP server context");
    },
    logger: {
      debug: () => {},
      error: () => {},
      info: () => {},
      warn: () => {},
    },
    signal: new AbortController().signal,
  };
}

export async function createMcpServer(
  config: McpHostServerConfig
): Promise<{ close(): Promise<void>; start(): Promise<void> }> {
  const { McpServer, StdioServerTransport, StreamableHTTPServerTransport } =
    await loadMcpServerSdk();

  const server = new McpServer({ name: config.name, version: config.version });

  for (const tool of config.tools) {
    const schema = pluginDefToMcpToolSchema(tool);
    server.registerTool(schema.name, schema.inputSchema, async (args: Record<string, unknown>) => {
      const result = await tool.run(args as never, createMockPluginCtx());
      return {
        content: [
          {
            text: typeof result === "string" ? result : JSON.stringify(result),
            type: "text",
          },
        ],
      };
    });
  }

  const transport =
    config.transport === "streamable-http"
      ? new StreamableHTTPServerTransport({ port: config.port ?? DEFAULTS.server.mcpPort })
      : new StdioServerTransport();

  return {
    close: async () => {
      await server.close();
      await transport.close();
    },
    start: async () => {
      await server.connect(transport);
    },
  };
}
