import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { z } from "zod";
import { mcpToPlugins } from "../../src/mcp/to-plugin";
import type { InternalPlugin } from "../../src/plugin";
import { convertZodToParamDef } from "../../src/plugin";
import { structuredAgent } from "../../src/structured";
import type {
  AgentEvent,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
  McpProvider,
  Message,
  StepContext,
  ToolDef,
} from "../../src/types";
import { defaultConfig, makeEmit, makePlugin } from "../utils/helpers";
import { runStreamReactLoop } from "../utils/loop-helpers";
import { textResponse, textStream, toolUseStream } from "../utils/responses";

function makeStreamProvider(
  streamFactory: (
    call: number,
    messages: Array<Message>,
    tools?: Array<ToolDef>
  ) => AsyncIterable<LLMStreamEvent>
): LLMProvider & { getCallCount: () => number } {
  let callCount = 0;
  return {
    async chat(_messages: Array<Message>) {
      return textResponse("unused");
    },
    chatStream(messages: Array<Message>, tools?: Array<ToolDef>) {
      callCount++;
      return streamFactory(callCount, messages, tools);
    },
    contextWindowSize: 200_000,
    getCallCount: () => callCount,
  };
}

describe("P6 Cross-Feature Integration", () => {
  describe("1. Streaming + Multi-step", () => {
    test("streaming with stopWhen and onStepFinish emits StreamChunk AND calls callbacks", async () => {
      const events: Array<AgentEvent> = [];
      const stepFinishes: Array<StepContext> = [];
      let stopWhenIterations = 0;

      const provider = makeStreamProvider((call) => {
        if (call === 1) {
          return toolUseStream("t1", "echo", { text: "hi" });
        }
        return textStream(["Step ", "2 ", "complete"]);
      });

      const plugins = new Map<string, InternalPlugin>([["echo", makePlugin("echo", { ok: true })]]);
      const toolDefs: Array<ToolDef> = [
        {
          description: "echo",
          inputSchema: {
            properties: { text: { type: "string" } },
            required: ["text"],
            type: "object",
          },
          name: "echo",
        },
      ];

      const result = await Effect.runPromise(
        runStreamReactLoop(
          [{ content: [{ text: "hi", type: "text" }], role: "user" }],
          toolDefs,
          plugins,
          provider,
          defaultConfig,
          new Set(),
          undefined,
          makeEmit(events),
          (ctx: StepContext) => {
            stopWhenIterations++;
            return ctx.iteration >= 1;
          },
          (ctx: StepContext) => {
            stepFinishes.push(ctx);
          }
        )
      );

      expect(result).toBe("Step 2 complete");

      const streamChunks = events.filter((e) => e.type === "stream.chunk");
      expect(streamChunks.length).toBeGreaterThan(0);
      expect(streamChunks.map((e) => (e as { content: string }).content)).toEqual([
        "Step ",
        "2 ",
        "complete",
      ]);

      expect(stepFinishes.length).toBeGreaterThan(0);
      expect(stopWhenIterations).toBeGreaterThan(0);
      expect(events.some((e) => e.type === "tool.call")).toBe(true);
      expect(events.some((e) => e.type === "tool.result")).toBe(true);
    });

    test("streaming loop emits multiple event types in single run", async () => {
      const events: Array<AgentEvent> = [];

      const provider = makeStreamProvider((call) => {
        if (call === 1) {
          return toolUseStream("t1", "echo", {});
        }
        return textStream(["Final", " result"]);
      });

      const plugins = new Map<string, InternalPlugin>([["echo", makePlugin("echo", "result")]]);
      const toolDefs: Array<ToolDef> = [
        {
          description: "echo",
          inputSchema: { properties: {}, required: [], type: "object" },
          name: "echo",
        },
      ];

      await Effect.runPromise(
        runStreamReactLoop(
          [{ content: [{ text: "hi", type: "text" }], role: "user" }],
          toolDefs,
          plugins,
          provider,
          defaultConfig,
          new Set(),
          undefined,
          makeEmit(events)
        )
      );

      const eventTypes = [...new Set(events.map((e) => e.type))];

      expect(eventTypes).toContain("stream.chunk");
      expect(eventTypes).toContain("tool.call");
      expect(eventTypes).toContain("tool.result");
      expect(eventTypes).toContain("agent.complete");
      expect(eventTypes.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("2. Structured output + Retry", () => {
    test("structuredAgent retries on validation failure then succeeds", async () => {
      const schema = z.object({
        name: z.string(),
        score: z.number(),
      });

      let callCount = 0;
      const mockProvider: LLMProvider = {
        async chat(): Promise<LLMResponse> {
          callCount++;
          if (callCount === 1) {
            return {
              content: [{ text: '{"name": "Alice"}', type: "text" }],
              stopReason: "end_turn",
              usage: { inputTokens: 10, outputTokens: 20 },
            };
          }
          return {
            content: [{ text: '{"name": "Alice", "score": 95}', type: "text" }],
            stopReason: "end_turn",
            usage: { inputTokens: 10, outputTokens: 20 },
          };
        },
        async *chatStream() {
          yield undefined as never;
          throw new Error("Not implemented");
        },
        contextWindowSize: 200_000,
      };

      const testAgent = structuredAgent({
        maxRetries: 2,
        name: "test",
        output: schema,
        prompt: "Generate test result",
      });

      const result = await testAgent.run("Test input", mockProvider);

      expect(callCount).toBe(2);
      expect(result).toEqual({ name: "Alice", score: 95 });
    });

    test("structuredAgent throws after max retries exceeded", async () => {
      const schema = z.object({
        value: z.number(),
      });

      const mockProvider: LLMProvider = {
        async chat(): Promise<LLMResponse> {
          return {
            content: [{ text: '{"value": "not-a-number"}', type: "text" }],
            stopReason: "end_turn",
            usage: { inputTokens: 10, outputTokens: 20 },
          };
        },
        async *chatStream() {
          yield undefined as never;
          throw new Error("Not implemented");
        },
        contextWindowSize: 200_000,
      };

      const testAgent = structuredAgent({
        maxRetries: 1,
        name: "test",
        output: schema,
        prompt: "Generate number",
      });

      await expect(testAgent.run("Test input", mockProvider)).rejects.toThrow();
    });
  });

  describe("3. MCP tools integration", () => {
    test("mcpToPlugins discovers tools and executes via provider", async () => {
      const callLog: Array<{ input: Record<string, unknown>; name: string }> = [];

      const mockMcpProvider: McpProvider = {
        callTool: async (name, input) => {
          callLog.push({ input, name });
          if (name === "calculator") {
            const { a, b, op } = input as { a: number; b: number; op: string };
            if (op === "add") {
              return a + b;
            }
            if (op === "multiply") {
              return a * b;
            }
            return 0;
          }
          if (name === "greeter") {
            return `Hello, ${(input as { name: string }).name}!`;
          }
          return null;
        },
        close: async () => {},
        connect: async () => {},
        listTools: async () => [
          {
            description: "Performs calculations",
            inputSchema: {
              properties: {
                a: { description: "First number", type: "number" },
                b: { description: "Second number", type: "number" },
                op: { description: "Operation", type: "string" },
              },
              required: ["a", "b", "op"],
              type: "object",
            },
            name: "calculator",
          },
          {
            description: "Greets someone",
            inputSchema: {
              properties: {
                name: { type: "string" },
              },
              required: ["name"],
              type: "object",
            },
            name: "greeter",
          },
        ],
      };

      const plugins = await mcpToPlugins(mockMcpProvider);

      expect(plugins).toHaveLength(2);
      expect(plugins.map((p) => p.name)).toContain("calculator");
      expect(plugins.map((p) => p.name)).toContain("greeter");

      const calcPlugin = plugins.find((p) => p.name === "calculator");
      if (!calcPlugin) {
        throw new Error("calculator plugin not found");
      }
      const calcParamDef = convertZodToParamDef(calcPlugin.params);
      // Required params don't have 'required' field set (undefined = required by default)
      expect(calcParamDef.a?.required).toBeUndefined();
      expect(calcParamDef.b?.required).toBeUndefined();
      expect(calcParamDef.op?.required).toBeUndefined();

      const calcResult = await calcPlugin.run({ a: 5, b: 3, op: "add" }, {
        exec: async () => ({}) as any,
        logger: console,
        signal: new AbortController().signal,
      } as any);

      expect(calcResult).toBe(8);
      expect(callLog).toContainEqual({ input: { a: 5, b: 3, op: "add" }, name: "calculator" });

      const greeterPlugin = plugins.find((p) => p.name === "greeter");
      if (!greeterPlugin) {
        throw new Error("greeter plugin not found");
      }
      const greetResult = await greeterPlugin.run({ name: "World" }, {
        exec: async () => ({}) as any,
        logger: console,
        signal: new AbortController().signal,
      } as any);

      expect(greetResult).toBe("Hello, World!");
      expect(callLog).toContainEqual({ input: { name: "World" }, name: "greeter" });
    });

    test("mcpToPlugins handles empty tool list", async () => {
      const mockMcpProvider: McpProvider = {
        callTool: async () => null,
        close: async () => {},
        connect: async () => {},
        listTools: async () => [],
      };

      const plugins = await mcpToPlugins(mockMcpProvider);
      expect(plugins).toHaveLength(0);
    });
  });

  describe("4. Event combination in single agent run", () => {
    test("single run emits PlannerThinking, ToolCalling, ToolResult, Complete", async () => {
      const events: Array<AgentEvent> = [];
      let callCount = 0;

      const mockProvider: LLMProvider = {
        async chat(_messages: Array<Message>): Promise<LLMResponse> {
          callCount++;
          if (callCount === 1) {
            return {
              content: [
                { text: "I'll help you with that", type: "text" },
                { input: {}, name: "helper", toolUseId: "t1", type: "tool_use" },
              ],
              stopReason: "tool_use",
              usage: { inputTokens: 10, outputTokens: 5 },
            };
          }
          return {
            content: [{ text: "Task completed successfully", type: "text" }],
            stopReason: "end_turn",
            usage: { inputTokens: 20, outputTokens: 10 },
          };
        },
        async *chatStream() {},
        contextWindowSize: 200_000,
      };

      const helperPlugin = makePlugin("helper", { result: "helper-output" });
      const plugins = new Map<string, InternalPlugin>([["helper", helperPlugin]]);

      const { runReactLoop } = await import("../utils/loop-helpers");

      await Effect.runPromise(
        runReactLoop(
          [{ content: [{ text: "Do something", type: "text" }], role: "user" }],
          [
            {
              description: "A helper tool",
              inputSchema: { properties: {}, required: [], type: "object" },
              name: "helper",
            },
          ],
          plugins,
          mockProvider,
          defaultConfig,
          new Set(),
          undefined,
          makeEmit(events)
        )
      );

      const eventTypes = events.map((e) => e.type);

      expect(eventTypes).toContain("agent.thinking");
      expect(eventTypes).toContain("tool.call");
      expect(eventTypes).toContain("tool.result");
      expect(eventTypes).toContain("agent.complete");

      const plannerIndex = eventTypes.indexOf("agent.thinking");
      const toolCallingIndex = eventTypes.indexOf("tool.call");
      const toolResultIndex = eventTypes.indexOf("tool.result");
      const completeIndex = eventTypes.indexOf("agent.complete");

      expect(plannerIndex).toBeLessThan(toolCallingIndex);
      expect(toolCallingIndex).toBeLessThan(toolResultIndex);
      expect(toolResultIndex).toBeLessThan(completeIndex);
    });

    test("multi-step run emits AgentTransition events", async () => {
      const events: Array<AgentEvent> = [];
      let callCount = 0;

      const mockProvider: LLMProvider = {
        async chat(): Promise<LLMResponse> {
          callCount++;
          if (callCount === 1) {
            return {
              content: [{ input: {}, name: "step1", toolUseId: "t1", type: "tool_use" }],
              stopReason: "tool_use",
              usage: { inputTokens: 10, outputTokens: 5 },
            };
          }
          if (callCount === 2) {
            return {
              content: [{ input: {}, name: "step2", toolUseId: "t2", type: "tool_use" }],
              stopReason: "tool_use",
              usage: { inputTokens: 20, outputTokens: 5 },
            };
          }
          return {
            content: [{ text: "All steps done", type: "text" }],
            stopReason: "end_turn",
            usage: { inputTokens: 30, outputTokens: 10 },
          };
        },
        async *chatStream() {},
        contextWindowSize: 200_000,
      };

      const plugins = new Map<string, InternalPlugin>([
        ["step1", makePlugin("step1", "step1-result")],
        ["step2", makePlugin("step2", "step2-result")],
      ]);

      const { runReactLoop } = await import("../utils/loop-helpers");

      await Effect.runPromise(
        runReactLoop(
          [{ content: [{ text: "Multi-step task", type: "text" }], role: "user" }],
          [
            {
              description: "Step 1",
              inputSchema: { properties: {}, required: [], type: "object" },
              name: "step1",
            },
            {
              description: "Step 2",
              inputSchema: { properties: {}, required: [], type: "object" },
              name: "step2",
            },
          ],
          plugins,
          mockProvider,
          defaultConfig,
          new Set(),
          undefined,
          makeEmit(events)
        )
      );

      const transitions = events.filter((e) => e.type === "agent.transition");
      expect(transitions.length).toBeGreaterThan(0);

      const toolCallings = events.filter((e) => e.type === "tool.call");
      const toolResults = events.filter((e) => e.type === "tool.result");
      expect(toolCallings.length).toBe(2);
      expect(toolResults.length).toBe(2);
    });
  });

  describe("5. Error event coverage", () => {
    test("Error event type exists in AgentEvent union", () => {
      const errorEvent: AgentEvent = {
        message: "Test error",
        timestamp: Date.now(),
        type: "agent.error",
      };
      expect(errorEvent.type).toBe("agent.error");
      expect(errorEvent.message).toBe("Test error");
    });
  });
});
