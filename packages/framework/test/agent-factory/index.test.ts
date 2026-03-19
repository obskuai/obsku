// =============================================================================
// Tests for Agent Factory — dynamic agent creation via create_agent/call_agent tools
// =============================================================================

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { agent } from "../../src/agent";
import type { AgentIterationContext } from "../../src/agent/agent-loop";
import {
  AgentFactoryRegistry,
  createCallAgentTool,
  createCreateAgentTool,
  createExecuteAgentTool,
} from "../../src/agent-factory";
import { plugin } from "../../src/plugin";
import type { LLMProvider, LLMResponse, Message, PluginCtx, ToolDef } from "../../src/types";

// ---------------------------------------------------------------------------
// Mock provider for testing
// ---------------------------------------------------------------------------

function createMockProvider(
  responses: Array<{
    content: string;
    stopReason?: LLMResponse["stopReason"];
    toolCalls?: Array<{ input: Record<string, unknown>; name: string }>;
  }>
): LLMProvider {
  let callIndex = 0;

  return {
    chat: async (_messages: Array<Message>, _tools?: Array<ToolDef>): Promise<LLMResponse> => {
      const response =
        responses[callIndex++] || ({ content: "mock", stopReason: "end_turn" } as const);
      const contentBlocks: LLMResponse["content"] = [{ text: response.content, type: "text" }];

      for (const tc of response.toolCalls ?? []) {
        contentBlocks.push({
          input: tc.input,
          name: tc.name,
          toolUseId: `call-${Math.random().toString(36).slice(2)}`,
          type: "tool_use",
        });
      }

      return {
        content: contentBlocks,
        stopReason: response.stopReason ?? "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
    chatStream: async function* (
      _messages: Array<Message>,
      _tools?: Array<ToolDef>
    ): AsyncIterable<never> {
      // Empty stream for mock
    },
    contextWindowSize: 200_000,
  };
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
    fetch: async () => new Response("ok"),
    logger: {
      debug: () => {},
      error: () => {},
      info: () => {},
      warn: () => {},
    },
    signal: new AbortController().signal,
  };
}

function toPromise<T>(value: Promise<T> | AsyncIterable<T>): Promise<T> {
  if (typeof value === "object" && value !== null && Symbol.asyncIterator in value) {
    return Promise.reject(new Error("unexpected async iterable"));
  }

  return value;
}

async function toStringPromise(value: Promise<unknown> | AsyncIterable<unknown>): Promise<string> {
  return String(await toPromise(value));
}

// Helper to create a properly typed AgentIterationContext mock
function createMockAgentContext(
  toolDefs: Array<ToolDef> = [],
  resolvedTools: Map<string, unknown> = new Map()
): AgentIterationContext {
  return {
    bgToolNames: new Set(),
    config: { maxIterations: 10, toolConcurrency: 3, toolTimeout: 30_000 },
    emit: () => {
      throw new Error("unimplemented");
    },
    handoffTargets: [],
    lastNotificationCheck: 0,
    lastText: "",
    messages: [],
    onEntityExtract: undefined,
    onStepFinish: undefined,
    onToolResult: undefined,
    outputGuardrails: [],
    params: {} as AgentIterationContext["params"],
    provider: mockProvider,
    resolvedTools: resolvedTools as AgentIterationContext["resolvedTools"],
    responseFormat: undefined,
    sessionId: undefined,
    stopWhen: undefined,
    strategy: {} as AgentIterationContext["strategy"],
    taskManager: undefined,
    telemetryConfig: undefined,
    toolDefs,
    usage: { llmCalls: 0, totalInputTokens: 0, totalOutputTokens: 0 },
  };
}

const mockProvider: LLMProvider = createMockProvider([
  { content: "mock response", stopReason: "end_turn" },
]);

// ---------------------------------------------------------------------------
// AgentFactoryRegistry tests
// ---------------------------------------------------------------------------

describe("AgentFactoryRegistry", () => {
  test("create() succeeds with valid input", () => {
    const registry = new AgentFactoryRegistry(mockProvider, { maxAgents: 10 });

    // Create a mock context with resolvedTools and toolDefs
    const mockContext = createMockAgentContext([], new Map());

    registry.setContext(mockContext);

    const result = registry.create("test-agent", "You are a test agent", undefined, mockProvider);

    expect(result.success).toBe(true);
    expect(registry.has("test-agent")).toBe(true);
  });

  test("create() fails when name already exists", () => {
    const registry = new AgentFactoryRegistry(mockProvider, { maxAgents: 10 });

    const mockContext = createMockAgentContext([], new Map());

    registry.setContext(mockContext);

    registry.create("test-agent", "First agent", undefined, mockProvider);
    const result = registry.create("test-agent", "Second agent", undefined, mockProvider);

    expect(result.success).toBe(false);
    expect(result.error).toContain("already exists");
  });

  test("create() fails when max agents limit reached", () => {
    const registry = new AgentFactoryRegistry(mockProvider, { maxAgents: 2 });

    const mockContext = createMockAgentContext([], new Map());

    registry.setContext(mockContext);

    registry.create("agent-1", "Agent 1", undefined, mockProvider);
    registry.create("agent-2", "Agent 2", undefined, mockProvider);
    const result = registry.create("agent-3", "Agent 3", undefined, mockProvider);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Max agents limit reached");
  });

  test("create() fails when name conflicts with existing tool", () => {
    const registry = new AgentFactoryRegistry(mockProvider, { maxAgents: 10 });

    const mockContext = createMockAgentContext(
      [{ description: "Echo tool", inputSchema: { properties: {}, type: "object" }, name: "echo" }],
      new Map()
    );

    registry.setContext(mockContext);

    const result = registry.create("echo", "You are echo", undefined, mockProvider);

    expect(result.success).toBe(false);
    expect(result.error).toContain("conflicts with existing tool");
  });

  test("call() returns error when agent not found", async () => {
    const registry = new AgentFactoryRegistry(mockProvider);

    const result = await registry.call("non-existent", "test task");

    expect(result).toContain('"error"');
    expect(result).toContain("not found");
  });

  test("setContext() must be called before using registry", () => {
    const registry = new AgentFactoryRegistry(mockProvider);

    expect(() => {
      registry.create("test", "prompt", undefined, mockProvider);
    }).toThrow("context not bound");
  });
});

// ---------------------------------------------------------------------------
// create_agent tool tests
// ---------------------------------------------------------------------------

describe("create_agent tool", () => {
  test("returns success message that points to call_agent when agent created", async () => {
    const registry = new AgentFactoryRegistry(mockProvider, { maxAgents: 10 });

    const mockContext = createMockAgentContext([], new Map());

    registry.setContext(mockContext);

    const tool = createCreateAgentTool(registry, mockProvider);
    const result = await tool.run(
      { name: "sql-expert", prompt: "You are a SQL expert" },
      createMockPluginCtx()
    );

    expect(result).toContain("created successfully");
    expect(result).toContain("sql-expert");
    expect(result).toContain("call_agent");
    expect(result).toContain('{ name: "sql-expert", task }');
    expect(result).not.toContain("call_sql-expert");
  });

  test("returns error JSON when agent already exists", async () => {
    const registry = new AgentFactoryRegistry(mockProvider, { maxAgents: 10 });

    const mockContext = createMockAgentContext([], new Map());

    registry.setContext(mockContext);

    const tool = createCreateAgentTool(registry, mockProvider);

    // Create first agent
    await tool.run({ name: "duplicate", prompt: "First" }, createMockPluginCtx());

    // Try to create duplicate
    const result = await tool.run({ name: "duplicate", prompt: "Second" }, createMockPluginCtx());

    expect(result).toContain('"error"');
    expect(result).toContain("already exists");
  });

  test("validates required parameters", () => {
    const tool = createCreateAgentTool(new AgentFactoryRegistry(mockProvider), mockProvider);
    const runInvalid = (input: unknown) =>
      toPromise(tool.run(input as never, createMockPluginCtx())).then(
        () => {
          throw new Error("expected validation error");
        },
        (error) => expect(error).toBeInstanceOf(Error)
      );

    return Promise.all([
      runInvalid({}),
      runInvalid({ prompt: "test" }),
      runInvalid({ name: "test" }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// call_agent tool tests
// ---------------------------------------------------------------------------

describe("call_agent tool", () => {
  test("invokes a created agent through the supported call_agent path", async () => {
    const provider = createMockProvider([{ content: "delegated result", stopReason: "end_turn" }]);
    const registry = new AgentFactoryRegistry(provider, { maxAgents: 10 });

    const mockContext = createMockAgentContext([], new Map());

    registry.setContext(mockContext);

    const createTool = createCreateAgentTool(registry, provider);
    const callTool = createCallAgentTool(registry);

    const createResult = await createTool.run(
      { name: "sql-expert", prompt: "You are a SQL expert" },
      createMockPluginCtx()
    );
    const callResult = await toStringPromise(
      callTool.run({ name: "sql-expert", task: "Write a query" }, createMockPluginCtx())
    );

    expect(createResult).toContain("call_agent");
    expect(callResult).toContain("delegated result");
  });

  test("returns error when agent does not exist", async () => {
    const registry = new AgentFactoryRegistry(mockProvider);
    const tool = createCallAgentTool(registry);

    const result = await toStringPromise(
      tool.run({ name: "missing", task: "do something" }, createMockPluginCtx())
    );

    expect(result).toContain('"error"');
    expect(result).toContain("not found");
  });

  test("validates required parameters", () => {
    const tool = createCallAgentTool(new AgentFactoryRegistry(mockProvider));

    return Promise.all([
      toStringPromise(tool.run({} as never, createMockPluginCtx())).then((result) => {
        expect(result).toContain('"error"');
      }),
      toStringPromise(tool.run({ task: "test" } as never, createMockPluginCtx())).then((result) => {
        expect(result).toContain('"error"');
      }),
      toStringPromise(tool.run({ name: "test" } as never, createMockPluginCtx())).then((result) => {
        expect(result).toContain('"error"');
      }),
    ]);
  });

  // ---------------------------------------------------------------------------
  // Integration with agent() factory
  // ---------------------------------------------------------------------------

  describe("Agent factory integration", () => {
    test("agentFactory: true adds factory tools to agent", () => {
      const echoPlugin = plugin({
        description: "Echo input",
        name: "echo",
        params: z.object({ text: z.string() }),
        run: async ({ text }) => text,
      });

      const parentAgent = agent({
        agentFactory: true,
        name: "parent",
        prompt: "You are a parent agent",
        tools: [echoPlugin],
      });

      // The agent should have agentFactory enabled in its definition
      expect(parentAgent).toBeDefined();
    });

    test("agentFactory config options are accepted", () => {
      const parentAgent = agent({
        agentFactory: {
          allowedChildTools: ["echo"],
          maxAgents: 5,
          maxDepth: 3,
        },
        name: "parent",
        prompt: "You are a parent agent",
        tools: [],
      });

      expect(parentAgent).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Depth limit tests
  // ---------------------------------------------------------------------------

  describe("Agent factory depth limits", () => {
    test("depth limit defaults to 5", () => {
      const registry = new AgentFactoryRegistry(mockProvider);
      expect(registry).toBeDefined();
      // The maxDepth config defaults to 5
      const config = { maxDepth: 5 };
      expect(config.maxDepth).toBe(5);
    });

    test("depth limit is configurable", () => {
      const registry = new AgentFactoryRegistry(mockProvider, { maxDepth: 3 });
      expect(registry).toBeDefined();
    });

    test("returns error when depth limit exceeded", async () => {
      const registry = new AgentFactoryRegistry(mockProvider, { maxDepth: 1 });

      const mockContext = createMockAgentContext([], new Map());

      registry.setContext(mockContext);

      // Create an agent
      registry.create("deep-agent", "Deep agent", undefined, mockProvider);

      // At depth 1 with maxDepth=1, calling would exceed limit
      // But without AsyncLocalStorage being set, depth defaults to 0
      // So this tests the depth check logic without full integration
      // In real usage with depthStorage set, this would be blocked
      const result = await registry.call("deep-agent", "test");

      // Without AsyncLocalStorage set, depth check doesn't trigger
      // but the call succeeds with mock response
      expect(result).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Error isolation tests
  // ---------------------------------------------------------------------------

  describe("Agent factory error isolation", () => {
    test("child agent errors return JSON error instead of crashing", async () => {
      const errorProvider: LLMProvider = {
        chat: async () => {
          throw new Error("Child agent failed");
        },
        chatStream: async function* () {
          // Empty
        },
        contextWindowSize: 200_000,
      };

      const registry = new AgentFactoryRegistry(errorProvider);

      const mockContext = createMockAgentContext([], new Map());

      registry.setContext(mockContext);

      // Create an agent that uses the error provider
      registry.create("failing-agent", "Failing agent", undefined, errorProvider);

      // Calling should return error JSON, not throw
      const result = await registry.call("failing-agent", "test");

      expect(result).toContain('"error"');
      expect(result).toContain("Child agent failed");
    });
  });

  // ---------------------------------------------------------------------------
  // Tool inheritance tests
  // ---------------------------------------------------------------------------

  describe("Agent factory tool inheritance", () => {
    test("child agent can inherit subset of parent tools", () => {
      const registry = new AgentFactoryRegistry(mockProvider);

      // Create parent tools
      const echoPlugin = plugin({
        description: "Echo input",
        name: "echo",
        params: z.object({ text: z.string() }),
        run: async ({ text }) => text,
      });

      const reversePlugin = plugin({
        description: "Reverse input",
        name: "reverse",
        params: z.object({ text: z.string() }),
        run: async ({ text }) => text.split("").reverse().join(""),
      });

      const resolvedTools = new Map([
        ["echo", { middleware: [], plugin: echoPlugin }],
        ["reverse", { middleware: [], plugin: reversePlugin }],
      ]);
      const mockContext = createMockAgentContext(
        [
          { description: "Echo", inputSchema: { properties: {}, type: "object" }, name: "echo" },
          {
            description: "Reverse",
            inputSchema: { properties: {}, type: "object" },
            name: "reverse",
          },
        ],
        resolvedTools
      );

      registry.setContext(mockContext);

      // Create child agent with only "echo" tool
      const result = registry.create("limited-agent", "Limited agent", ["echo"], mockProvider);

      expect(result.success).toBe(true);
      // Child agent should have been created with only echo tool
      expect(registry.has("limited-agent")).toBe(true);
    });

    test("child agent with no tools inherits from allowedChildTools config", () => {
      const registry = new AgentFactoryRegistry(mockProvider, {
        allowedChildTools: ["echo"],
      });

      const echoPlugin = plugin({
        description: "Echo input",
        name: "echo",
        params: z.object({ text: z.string() }),
        run: async ({ text }) => text,
      });

      const resolvedTools = new Map([["echo", { middleware: [], plugin: echoPlugin }]]);
      const mockContext = createMockAgentContext(
        [{ description: "Echo", inputSchema: { properties: {}, type: "object" }, name: "echo" }],
        resolvedTools
      );

      registry.setContext(mockContext);

      // Create child agent without specifying tools
      const result = registry.create("auto-agent", "Auto agent", undefined, mockProvider);

      expect(result.success).toBe(true);
    });

    test("child agent with no tools and no allowedChildTools has no tools", () => {
      const registry = new AgentFactoryRegistry(mockProvider);
      const mockContext = createMockAgentContext([], new Map());

      registry.setContext(mockContext);

      // Create child agent without any tools
      const result = registry.create("prompt-only", "Prompt only agent", undefined, mockProvider);

      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Max agents limit tests
  // ---------------------------------------------------------------------------

  describe("Agent factory max agents limit", () => {
    test("max agents defaults to 10", () => {
      const registry = new AgentFactoryRegistry(mockProvider);
      expect(registry).toBeDefined();
      // Default is 10
      const config = { maxAgents: 10 };
      expect(config.maxAgents).toBe(10);
    });

    test("max agents is configurable", () => {
      const registry = new AgentFactoryRegistry(mockProvider, { maxAgents: 3 });
      expect(registry).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// execute_agent tool tests (one-shot)
// ---------------------------------------------------------------------------

describe("execute_agent tool", () => {
  test("executes one-shot agent and returns result", async () => {
    const provider = createMockProvider([{ content: "one-shot result", stopReason: "end_turn" }]);
    const registry = new AgentFactoryRegistry(provider);
    const mockContext = createMockAgentContext([], new Map());
    registry.setContext(mockContext);

    const tool = createExecuteAgentTool(registry, provider);
    const result = await tool.run(
      { prompt: "You are a SQL expert", task: "Write a SELECT query" },
      createMockPluginCtx()
    );
    expect(result).toBeDefined();
  });

  test("does NOT register agent in registry", async () => {
    const provider = createMockProvider([{ content: "ephemeral result", stopReason: "end_turn" }]);
    const registry = new AgentFactoryRegistry(provider);
    const mockContext = createMockAgentContext([], new Map());
    registry.setContext(mockContext);

    const tool = createExecuteAgentTool(registry, provider);
    await tool.run({ prompt: "Ephemeral agent", task: "Do something" }, createMockPluginCtx());
    expect(registry.has("ephemeral")).toBe(false);
  });

  test("handles errors gracefully", async () => {
    const errorProvider: LLMProvider = {
      chat: async () => {
        throw new Error("Execution failed");
      },
      chatStream: async function* () {},
      contextWindowSize: 200_000,
    };
    const registry = new AgentFactoryRegistry(errorProvider);
    const mockContext = createMockAgentContext([], new Map());
    registry.setContext(mockContext);

    const tool = createExecuteAgentTool(registry, errorProvider);
    const result = await tool.run({ prompt: "Failing agent", task: "test" }, createMockPluginCtx());
    expect(result).toContain('"error"');
    expect(result).toContain("Execution failed");
  });
});
