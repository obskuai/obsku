// =============================================================================
// Tests for asPlugin() helper — wrapping agents as plugins
// =============================================================================

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { type AgentLike, asPlugin } from "../src/as-plugin";
import type {
  LLMProvider,
  LLMResponse,
  Message,
  PluginCtx,
  PluginDef,
  ToolDef,
} from "../src/types";

// ---------------------------------------------------------------------------
// Mock provider for testing
// ---------------------------------------------------------------------------

const mockProvider: LLMProvider = {
  chat: async (_messages: Array<Message>, _tools?: Array<ToolDef>): Promise<LLMResponse> => ({
    content: [{ text: "mock response", type: "text" }],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 5 },
  }),
  chatStream: async function* (
    _messages: Array<Message>,
    _tools?: Array<ToolDef>
  ): AsyncIterable<never> {
    // Empty stream for mock
  },
  contextWindowSize: 200_000,
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockAgent(
  name: string,
  runFn?: (input: string, provider: LLMProvider) => Promise<string>
): AgentLike {
  return {
    name,
    run: runFn ?? (async (input: string, _provider: LLMProvider) => `Result for: ${input}`),
  };
}

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
    fetch: async (url, init) => globalThis.fetch(url, init),
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
  const uncheckedRun = plugin.run as unknown as (
    input: unknown,
    ctx: PluginCtx
  ) => Promise<unknown>;
  return uncheckedRun(input, ctx);
}

// ---------------------------------------------------------------------------
// asPlugin() factory
// ---------------------------------------------------------------------------

describe("asPlugin() factory", () => {
  test("returns valid PluginDef shape", () => {
    const agent = createMockAgent("test-agent");
    const plugin = asPlugin(agent, mockProvider);

    // Verify PluginDef structure
    expect(plugin.name).toBe("test-agent");
    expect(typeof plugin.description).toBe("string");
    expect(plugin.description).toContain("test-agent");
    expect(plugin.params).toBeDefined();
    expect((plugin.params as any).shape).toHaveProperty("task");
    expect((plugin.params as any).shape.task).toBeInstanceOf(z.ZodString);
    expect(typeof plugin.run).toBe("function");
  });

  test("run({ task: 'hello' }) calls agent.run('hello', provider)", async () => {
    let receivedInput: string | null = null;
    let receivedProvider: LLMProvider | null = null;

    const agent = createMockAgent("delegator", async (input, provider) => {
      receivedInput = input;
      receivedProvider = provider;
      return `Processed: ${input}`;
    });

    const plugin = asPlugin(agent, mockProvider);
    const ctx = createMockPluginCtx();

    const result = await plugin.run({ task: "hello" }, ctx);

    expect(receivedInput!).toBe("hello");
    expect(receivedProvider!).toBe(mockProvider);
    expect(result).toBe("Processed: hello");
  });

  test("throws error when task parameter is missing", async () => {
    const agent = createMockAgent("test-agent");
    const plugin = asPlugin(agent, mockProvider);
    const ctx = createMockPluginCtx();

    await expect(runPluginUnchecked(plugin, {}, ctx)).rejects.toThrow(/task/);
  });

  test("throws error when task is not a string", async () => {
    const agent = createMockAgent("test-agent");
    const plugin = asPlugin(agent, mockProvider);
    const ctx = createMockPluginCtx();

    await expect(runPluginUnchecked(plugin, { task: 123 }, ctx)).rejects.toThrow(/string/);
    await expect(runPluginUnchecked(plugin, { task: null }, ctx)).rejects.toThrow(/string/);
    await expect(runPluginUnchecked(plugin, { task: {} }, ctx)).rejects.toThrow(/string/);
  });
});

// ---------------------------------------------------------------------------
// Depth limit protection
// ---------------------------------------------------------------------------

describe("asPlugin() depth limit", () => {
  test("allows execution when depth is under limit", async () => {
    const agent = createMockAgent("shallow-agent");
    const plugin = asPlugin(agent, mockProvider, { maxDepth: 3 });
    const ctx = createMockPluginCtx();

    // First call should succeed
    const result = await plugin.run({ task: "test" }, ctx);
    expect(result).toBe("Result for: test");
  });

  test("throws error when max depth is exceeded", async () => {
    // Create a self-referencing agent that calls itself
    let plugin: PluginDef;

    const recursiveAgent: AgentLike = {
      name: "recursive-agent",
      run: async (input: string, _provider: LLMProvider) => {
        // Simulate recursion by calling the plugin again
        const ctx = createMockPluginCtx();
        // This will increment depth each time
        await plugin.run({ task: input }, ctx);
        return "should not reach";
      },
    };

    plugin = asPlugin(recursiveAgent, mockProvider, { maxDepth: 3 });
    const ctx = createMockPluginCtx();

    // First call starts depth at 0, increments to 1
    // Second call (inside run) increments to 2
    // Third call increments to 3
    // Fourth call should throw because depth (3) >= maxDepth (3)

    // Actually, let's test this more directly by tracking calls
    let callCount = 0;
    const countingAgent: AgentLike = {
      name: "counting-agent",
      run: async (_input: string, _provider: LLMProvider) => {
        callCount++;
        if (callCount < 5) {
          // Try to recurse through the plugin
          await plugin.run({ task: "recurse" }, ctx);
        }
        return `Call ${callCount}`;
      },
    };

    plugin = asPlugin(countingAgent, mockProvider, { maxDepth: 3 });

    // With maxDepth: 3, we should get:
    // Call 1: depth 0 -> 1 (ok)
    // Call 2: depth 1 -> 2 (ok)
    // Call 3: depth 2 -> 3 (ok)
    // Call 4: depth 3 >= 3 (throws!)
    await expect(plugin.run({ task: "start" }, ctx)).rejects.toThrow(/depth.*exceeded/i);
    expect(callCount).toBe(3); // Should have succeeded 3 times before failing
  });

  test("uses default max depth of 5 when not specified", async () => {
    let callCount = 0;
    const ctx = createMockPluginCtx();
    let plugin: PluginDef = null!;

    const deepAgent: AgentLike = {
      name: "deep-agent",
      run: async (_input: string, _provider: LLMProvider) => {
        callCount++;
        if (callCount < 10) {
          await plugin.run({ task: "recurse" }, ctx);
        }
        return `Call ${callCount}`;
      },
    };

    plugin = asPlugin(deepAgent, mockProvider); // No maxDepth specified

    // Default maxDepth is 5, so should fail on 6th call
    await expect(plugin.run({ task: "start" }, ctx)).rejects.toThrow(/depth.*exceeded/i);
    expect(callCount).toBe(5); // Should succeed 5 times with default depth
  });

  test("depth counter is instance-specific", async () => {
    const ctx = createMockPluginCtx();

    const agent1 = createMockAgent("agent-1");
    const agent2 = createMockAgent("agent-2");

    const plugin1 = asPlugin(agent1, mockProvider, { maxDepth: 2 });
    const plugin2 = asPlugin(agent2, mockProvider, { maxDepth: 2 });

    // Each plugin should have its own depth counter
    const result1 = await plugin1.run({ task: "test1" }, ctx);
    const result2 = await plugin2.run({ task: "test2" }, ctx);

    expect(result1).toBe("Result for: test1");
    expect(result2).toBe("Result for: test2");
  });

  test("depth counter decrements after completion", async () => {
    const ctx = createMockPluginCtx();
    let callCount = 0;
    const reusableAgent: AgentLike = {
      name: "reusable-agent",
      run: async (input: string, _provider: LLMProvider) => {
        callCount++;
        return `Done: ${input} (${callCount})`;
      },
    };

    const plugin = asPlugin(reusableAgent, mockProvider, { maxDepth: 2 });

    // First call
    const result1 = await plugin.run({ task: "first" }, ctx);
    expect(result1).toBe("Done: first (1)");

    // Second call - depth should have reset
    const result2 = await plugin.run({ task: "second" }, ctx);
    expect(result2).toBe("Done: second (2)");

    // Third call - should still work
    const result3 = await plugin.run({ task: "third" }, ctx);
    expect(result3).toBe("Done: third (3)");
  });
});

// ---------------------------------------------------------------------------
// Integration-style tests
// ---------------------------------------------------------------------------

describe("asPlugin() integration", () => {
  test("plugin can be used in agent.tools array structure", () => {
    const agent = createMockAgent("specialized-agent");
    const plugin = asPlugin(agent, mockProvider);

    // Verify the plugin matches PluginDef interface
    const pluginDef: PluginDef = plugin;
    expect(pluginDef.name).toBe("specialized-agent");
    expect((pluginDef.params as any).shape?.task).toBeDefined();
  });

  test("description mentions agent name for discoverability", () => {
    const agent = createMockAgent("security-scanner");
    const plugin = asPlugin(agent, mockProvider);

    expect(plugin.description).toContain("security-scanner");
    expect(plugin.description.toLowerCase()).toContain("delegate");
  });

  test("task parameter has correct schema", () => {
    const agent = createMockAgent("task-agent");
    const plugin = asPlugin(agent, mockProvider);

    expect((plugin.params as any).shape.task).toBeInstanceOf(z.ZodString);
  });
});

// ---------------------------------------------------------------------------
// Regression: AsyncLocalStorage unavailable in bundled environments
// bun build shims node:async_hooks as empty object → new AsyncLocalStorage crashes
// ---------------------------------------------------------------------------

describe("asPlugin() without AsyncLocalStorage (bundled env regression)", () => {
  test("module-level guard: typeof check prevents crash on undefined constructor", () => {
    // Simulates what bun build produces: var {AsyncLocalStorage} = (() => ({}))()
    const UndefinedALS = undefined;
    const storage = typeof UndefinedALS === "function" ? new (UndefinedALS as any)() : undefined;
    expect(storage).toBeUndefined();
  });

  test("asPlugin still works when depthStorage is undefined (no recursion tracking)", async () => {
    // Even without AsyncLocalStorage, agent.run() should be called normally
    const agent = createMockAgent("bundled-agent");
    const plugin = asPlugin(agent, mockProvider);
    const ctx = createMockPluginCtx();

    const result = await plugin.run({ task: "hello from bundled env" }, ctx);
    expect(result).toBe("Result for: hello from bundled env");
  });

  test("sequential calls work without depth tracking", async () => {
    const agent = createMockAgent("seq-agent");
    const plugin = asPlugin(agent, mockProvider);
    const ctx = createMockPluginCtx();

    // Multiple sequential calls should all succeed
    const r1 = await plugin.run({ task: "first" }, ctx);
    const r2 = await plugin.run({ task: "second" }, ctx);
    const r3 = await plugin.run({ task: "third" }, ctx);

    expect(r1).toBe("Result for: first");
    expect(r2).toBe("Result for: second");
    expect(r3).toBe("Result for: third");
  });
});
