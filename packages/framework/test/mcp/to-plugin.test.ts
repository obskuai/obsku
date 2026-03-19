import { describe, expect, test } from "bun:test";
import { mcpToPlugins } from "../../src/mcp/to-plugin";
import { convertZodToParamDef } from "../../src/plugin";
import type { McpProvider } from "../../src/types";

describe("mcpToPlugins", () => {
  test("converts MCP tools to PluginDef[]", async () => {
    const provider: McpProvider = {
      callTool: async (): Promise<any> => "ok",
      close: async () => {},
      connect: async () => {},
      listTools: async () => [
        {
          description: "Ping tool",
          inputSchema: {
            properties: { host: { description: "Target", type: "string" } },
            required: ["host"],
            type: "object",
          },
          name: "ping",
        },
      ],
    };

    const plugins = await mcpToPlugins(provider);

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      description: "Ping tool",
      name: "ping",
    });
    const paramDef = convertZodToParamDef(plugins[0].params);
    expect(paramDef.host).toMatchObject({
      description: "Target",
      type: "string",
    });
    // Required params don't have 'required' field set (undefined = required by default)
    expect(paramDef.host?.required).toBeUndefined();
  });

  test("run() calls provider.callTool()", async () => {
    let captured: { input: Record<string, unknown>; name: string } | null = null;
    const provider: McpProvider = {
      callTool: async (name, input): Promise<any> => {
        captured = { input, name };
        return 42;
      },
      close: async () => {},
      connect: async () => {},
      listTools: async () => [
        {
          description: "Sum tool",
          inputSchema: { properties: { a: { type: "number" } }, required: ["a"], type: "object" },
          name: "sum",
        },
      ],
    };

    const plugins = await mcpToPlugins(provider);
    const result = await plugins[0].run({ a: 2 }, {
      exec: async () => ({}) as any,
      logger: console,
      signal: new AbortController().signal,
    } as any);

    if (!captured) {
      throw new Error("callTool not invoked");
    }
    expect(captured as any).toEqual({ input: { a: 2 }, name: "sum" });
    expect(result).toBe(42);
  });

  test("maps required flags from JSON schema", async () => {
    const provider: McpProvider = {
      callTool: async (): Promise<any> => "ok",
      close: async () => {},
      connect: async () => {},
      listTools: async () => [
        {
          description: "Echo",
          inputSchema: {
            properties: {
              optional: { type: "string" },
              text: { type: "string" },
            },
            required: ["text"],
            type: "object",
          },
          name: "echo",
        },
      ],
    };

    const plugins = await mcpToPlugins(provider);

    const paramDef = convertZodToParamDef(plugins[0].params);
    // Required params don't have 'required' field set (undefined = required by default)
    expect(paramDef.text?.required).toBeUndefined();
    // Optional params have required: false
    expect(paramDef.optional?.required).toBe(false);
  });

  test("preserves nested object schema", async () => {
    const provider: McpProvider = {
      callTool: async (): Promise<any> => "ok",
      close: async () => {},
      connect: async () => {},
      listTools: async () => [
        {
          description: "Nested object tool",
          inputSchema: {
            properties: {
              config: {
                properties: {
                  host: { type: "string" },
                },
                required: ["host"],
                type: "object",
              },
            },
            required: ["config"],
            type: "object",
          },
          name: "nested-object",
        },
      ],
    };

    const [plugin] = await mcpToPlugins(provider);
    const paramDef = convertZodToParamDef(plugin.params);

    expect(paramDef.config).toMatchObject({ type: "object" });
    expect(paramDef.config?.required).toBeUndefined();
    expect(plugin.params.safeParse({ config: {} }).success).toBe(false);
    expect(plugin.params.safeParse({ config: { host: "localhost" } }).success).toBe(true);
    expect(plugin.params.safeParse({ config: { extra: 123, host: "localhost" } }).success).toBe(
      true
    );
  });

  test("preserves array item schema", async () => {
    const provider: McpProvider = {
      callTool: async (): Promise<any> => "ok",
      close: async () => {},
      connect: async () => {},
      listTools: async () => [
        {
          description: "Array tool",
          inputSchema: {
            properties: {
              targets: {
                items: { type: "number" },
                type: "array",
              },
            },
            required: ["targets"],
            type: "object",
          },
          name: "array-items",
        },
      ],
    };

    const [plugin] = await mcpToPlugins(provider);
    const paramDef = convertZodToParamDef(plugin.params);

    expect(paramDef.targets).toMatchObject({ type: "array" });
    expect(paramDef.targets?.required).toBeUndefined();
    expect(plugin.params.safeParse({ targets: [1, 2, 3] }).success).toBe(true);
    expect(plugin.params.safeParse({ targets: [1, "two", { three: 3 }] }).success).toBe(false);
  });

  test("preserves enum schema", async () => {
    const provider: McpProvider = {
      callTool: async (): Promise<any> => "ok",
      close: async () => {},
      connect: async () => {},
      listTools: async () => [
        {
          description: "Enum tool",
          inputSchema: {
            properties: {
              mode: {
                enum: ["ping", "trace"],
                type: "string",
              },
            },
            required: ["mode"],
            type: "object",
          },
          name: "enum-tool",
        },
      ],
    };

    const [plugin] = await mcpToPlugins(provider);
    const paramDef = convertZodToParamDef(plugin.params);

    expect(paramDef.mode).toMatchObject({ type: "string" });
    expect(plugin.params.safeParse({ mode: "ping" }).success).toBe(true);
    expect(plugin.params.safeParse({ mode: "not-in-enum" }).success).toBe(false);
  });

  test("preserves top-level and nested required fields", async () => {
    const provider: McpProvider = {
      callTool: async (): Promise<any> => "ok",
      close: async () => {},
      connect: async () => {},
      listTools: async () => [
        {
          description: "Required flags tool",
          inputSchema: {
            properties: {
              nested: {
                properties: {
                  leaf: { type: "string" },
                },
                required: ["leaf"],
                type: "object",
              },
              optional: { type: "string" },
              requiredText: { type: "string" },
            },
            required: ["nested", "requiredText"],
            type: "object",
          },
          name: "required-flags",
        },
      ],
    };

    const [plugin] = await mcpToPlugins(provider);
    const paramDef = convertZodToParamDef(plugin.params);

    expect(paramDef.requiredText?.required).toBeUndefined();
    expect(paramDef.optional?.required).toBe(false);
    expect(plugin.params.safeParse({ nested: {} }).success).toBe(false);
    expect(plugin.params.safeParse({ nested: {}, requiredText: "ok" }).success).toBe(false);
    expect(plugin.params.safeParse({ nested: { leaf: "ok" }, requiredText: "ok" }).success).toBe(
      true
    );
  });
});
