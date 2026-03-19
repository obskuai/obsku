// =============================================================================
// Framework-level plugin compatibility tests for @obsku/adapter-claude-code
// Verifies the Claude Code plugin behaves like any other obsku plugin
// =============================================================================

import { describe, expect, test } from "bun:test";
import { plugin } from "@obsku/framework";
import { Effect } from "effect";
import { ClaudeCodePluginParamsSchema, createClaudeCodePlugin } from "../src/plugin";

describe("createClaudeCodePlugin", () => {
  test("returns a valid plugin definition", () => {
    const pluginDef = createClaudeCodePlugin();

    expect(pluginDef).toBeDefined();
    expect(pluginDef.name).toBe("claude_code");
    expect(pluginDef.description).toBeDefined();
    expect(pluginDef.description.length).toBeGreaterThan(0);
    expect(pluginDef.params).toBeDefined();
    expect(pluginDef.run).toBeDefined();
  });

  test("plugin name is exactly 'claude_code'", () => {
    const pluginDef = createClaudeCodePlugin();
    expect(pluginDef.name).toBe("claude_code");
    // Ensure it's not a special framework primitive
    expect(pluginDef.name).not.toBe("agent_factory");
    expect(pluginDef.name).not.toBe("internal");
    expect(pluginDef.name).not.toStartWith("__");
  });

  test("plugin has params schema defined", () => {
    const pluginDef = createClaudeCodePlugin();

    // Should have params definition
    expect(pluginDef.params).toBeDefined();
    expect(typeof pluginDef.params).toBe("object");
  });

  test("plugin has run function", () => {
    const pluginDef = createClaudeCodePlugin();
    expect(typeof pluginDef.run).toBe("function");
  });

  test("plugin accepts configuration options", () => {
    const withConfig = createClaudeCodePlugin({
      cwd: "/tmp",
      extraTools: ["Bash"],
    });

    expect(withConfig.name).toBe("claude_code");
    expect(withConfig.run).toBeDefined();
  });

  test("plugin works with empty config", () => {
    const defaultPlugin = createClaudeCodePlugin();
    const emptyPlugin = createClaudeCodePlugin({});

    expect(defaultPlugin.name).toBe(emptyPlugin.name);
    expect(defaultPlugin.description).toBe(emptyPlugin.description);
  });

  test("plugin is not a framework special-case", () => {
    const pluginDef = createClaudeCodePlugin();

    // Verify it doesn't have special framework markers
    expect(pluginDef.name).not.toStartWith("_");
    expect(pluginDef.name).not.toStartWith("$");

    // Should be a regular plugin definition, not a primitive
    const pluginKeys = Object.keys(pluginDef);
    expect(pluginKeys).toContain("name");
    expect(pluginKeys).toContain("description");
    expect(pluginKeys).toContain("params");
    expect(pluginKeys).toContain("run");

    // Should not have framework-internal-only properties
    expect(pluginKeys).not.toContain("_isFrameworkPrimitive");
    expect(pluginKeys).not.toContain("_internal");
  });

  test("plugin definition structure matches framework contract", () => {
    const pluginDef = createClaudeCodePlugin();

    // All plugin definitions must have these properties
    const requiredProps = ["name", "description", "params", "run"];
    for (const prop of requiredProps) {
      expect(pluginDef).toHaveProperty(prop);
    }

    // Type checks
    expect(typeof pluginDef.name).toBe("string");
    expect(typeof pluginDef.description).toBe("string");
    expect(typeof pluginDef.params).toBe("object");
    expect(typeof pluginDef.run).toBe("function");
  });

  test("plugin description is meaningful", () => {
    const pluginDef = createClaudeCodePlugin();

    expect(pluginDef.description).toContain("Claude");
    expect(pluginDef.description.length).toBeGreaterThan(10);
  });

  test("plugin params schema is a valid Zod schema", () => {
    const pluginDef = createClaudeCodePlugin();

    // Check that params is a Zod schema with expected methods
    expect(pluginDef.params).toHaveProperty("parse");
    expect(pluginDef.params).toHaveProperty("safeParse");
    expect(typeof pluginDef.params.parse).toBe("function");
    expect(typeof pluginDef.params.safeParse).toBe("function");
  });

  test("plugin params schema validates correctly", () => {
    // Valid params should pass
    const validResult = ClaudeCodePluginParamsSchema.safeParse({
      mode: "text",
      prompt: "test prompt",
    });
    expect(validResult.success).toBe(true);

    // Missing required 'prompt' should fail
    const invalidResult = ClaudeCodePluginParamsSchema.safeParse({
      mode: "text",
    });
    expect(invalidResult.success).toBe(false);
  });
});

describe("Plugin integration with framework plugin() factory", () => {
  test("plugin definition can be passed to plugin() factory", () => {
    const pluginDef = createClaudeCodePlugin();

    // Should not throw when creating plugin
    const internalPlugin = plugin(pluginDef);

    expect(internalPlugin).toBeDefined();
    expect(internalPlugin.name).toBe("claude_code");
    expect(internalPlugin.execute).toBeDefined();
    expect(typeof internalPlugin.execute).toBe("function");
  });

  test("plugin validates required params through framework", async () => {
    const pluginDef = createClaudeCodePlugin();
    const internalPlugin = plugin(pluginDef);

    // Missing required 'prompt' field
    const result = await Effect.runPromise(internalPlugin.execute({}).pipe(Effect.either));

    expect(result._tag).toBe("Left");
  });

  test("created plugin can be used in tools array", () => {
    const pluginDef = createClaudeCodePlugin();
    const internalPlugin = plugin(pluginDef);

    // Simulate how it would be used in an agent definition
    const mockAgentConfig = {
      name: "test-agent",
      prompt: "Test agent",
      tools: [internalPlugin],
    };

    expect(mockAgentConfig.tools).toHaveLength(1);
    expect(mockAgentConfig.tools[0].name).toBe("claude_code");
  });

  test("plugin maintains identity when referenced multiple times", () => {
    const pluginDef1 = createClaudeCodePlugin();
    const pluginDef2 = createClaudeCodePlugin();

    // Each call creates a new plugin definition instance
    expect(pluginDef1).not.toBe(pluginDef2);
    // But they have the same name
    expect(pluginDef1.name).toBe(pluginDef2.name);
  });

  test("plugin with different configs are distinct", () => {
    const defaultPlugin = createClaudeCodePlugin();
    const customPlugin = createClaudeCodePlugin({ cwd: "/custom" });

    // Different instances
    expect(defaultPlugin).not.toBe(customPlugin);
    // But same name
    expect(defaultPlugin.name).toBe(customPlugin.name);
  });
});

describe("ClaudeCodePluginParamsSchema", () => {
  test("exported schema validates prompt parameter", () => {
    const result = ClaudeCodePluginParamsSchema.safeParse({
      prompt: "Hello Claude",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prompt).toBe("Hello Claude");
    }
  });

  test("exported schema validates all parameters", () => {
    const result = ClaudeCodePluginParamsSchema.safeParse({
      cwd: "/tmp",
      mode: "json",
      prompt: "Test prompt",
      schema: { type: "object" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.prompt).toBe("Test prompt");
      expect(result.data.mode).toBe("json");
      expect(result.data.cwd).toBe("/tmp");
      expect(result.data.schema).toEqual({ type: "object" });
    }
  });

  test("exported schema rejects invalid mode", () => {
    const result = ClaudeCodePluginParamsSchema.safeParse({
      mode: "invalid",
      prompt: "Test",
    });
    expect(result.success).toBe(false);
  });
});
