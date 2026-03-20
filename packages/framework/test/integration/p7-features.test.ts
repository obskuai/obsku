import { beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { z } from "zod";
import { agent } from "../../src/agent";
import { InMemoryProvider } from "../../src/memory";
import type { InternalPlugin } from "../../src/plugin";
import { plugin } from "../../src/plugin";
import { _resetOtelLoader, clearRecordedSpans, getRecordedSpans } from "../../src/telemetry/tracer";
import type {
  AgentDef,
  AgentEvent,
  LLMProvider,
  LLMResponse,
  Message,
  ToolDef,
} from "../../src/types";
import { defaultConfig, makeEmit, makePlugin } from "../utils/helpers";
import { runReactLoop } from "../utils/loop-helpers";
import { textResponse } from "../utils/responses";

describe("P7 Cross-Feature Integration", () => {
  beforeEach(() => {
    clearRecordedSpans();
    _resetOtelLoader();
  });

  describe("1. Agent with memory + guardrails + HITL", () => {
    test("memory loads history, guardrail blocks bad input, before-hook fires on tool call", async () => {
      const memory = new InMemoryProvider();
      await memory.save("s1", [
        { content: [{ text: "previous", type: "text" }], role: "user" },
        { content: [{ text: "history", type: "text" }], role: "assistant" },
      ]);

      let callCount = 0;
      const toolCallLog: Array<string> = [];

      const mockProvider: LLMProvider = {
        async chat(_messages: Array<Message>): Promise<LLMResponse> {
          callCount++;
          if (callCount === 1) {
            return {
              content: [
                { text: "Using tool", type: "text" },
                { input: { target: "safe" }, name: "scanner", toolUseId: "t1", type: "tool_use" },
              ],
              stopReason: "tool_use",
              usage: { inputTokens: 20, outputTokens: 10 },
            };
          }
          return textResponse("Scan complete");
        },
        async *chatStream() {},
        contextWindowSize: 200_000,
      };

      const scannerParams = z.object({ target: z.string() });
      const scannerTool = plugin({
        description: "Scans target",
        name: "scanner",
        params: scannerParams,
        run: async ({ target }: z.output<typeof scannerParams>) => {
          toolCallLog.push("scanner");
          return `scanned ${target}`;
        },
      });

      const def: AgentDef = {
        guardrails: {
          input: [
            ({ input }) => ({
              allow: !input?.includes("malicious"),
              reason: "blocked malicious input",
            }),
          ],
        },
        memory,
        name: "test-agent",
        prompt: "Security scanner",
        toolMiddleware: [
          async (ctx, next) => {
            toolCallLog.push(ctx.toolName);
            return next();
          },
        ],
        tools: [scannerTool],
      };

      const a = agent(def);
      const result = await a.run("scan target", mockProvider, { sessionId: "s1" });

      expect(result).toBe("Scan complete");
      expect(toolCallLog).toContain("scanner");

      const savedHistory = await memory.load("s1");
      expect(savedHistory.length).toBeGreaterThan(2);
    });

    test("guardrail blocks malicious input with memory loaded", async () => {
      const memory = new InMemoryProvider();
      await memory.save("s2", []);

      const def: AgentDef = {
        guardrails: {
          input: [
            ({ input }) => ({
              allow: !input?.includes("malicious"),
              reason: "blocked",
            }),
          ],
        },
        memory,
        name: "guarded",
        prompt: "Test",
      };

      const mockProvider: LLMProvider = {
        async chat(): Promise<LLMResponse> {
          return textResponse("should not reach");
        },
        async *chatStream() {},
        contextWindowSize: 200_000,
      };

      const a = agent(def);
      return expect(a.run("malicious payload", mockProvider, { sessionId: "s2" })).rejects.toThrow(
        "blocked"
      );
    });
  });

  describe("2. Agent with handoff", () => {
    test("agent hands off to target agent", async () => {
      let callCount = 0;

      const provider: LLMProvider = {
        async chat(): Promise<LLMResponse> {
          callCount++;
          if (callCount === 1) {
            return {
              content: [
                { input: {}, name: "transfer_to_specialist", toolUseId: "h1", type: "tool_use" },
              ],
              stopReason: "tool_use",
              usage: { inputTokens: 10, outputTokens: 5 },
            };
          }
          return textResponse("Specialist completed task");
        },
        async *chatStream() {},
        contextWindowSize: 200_000,
      };

      const specialist: AgentDef = {
        name: "specialist",
        prompt: "I am a specialist",
      };

      const mainAgent = agent({
        handoffs: [{ agent: specialist, description: "Specialist for tasks" }],
        name: "router",
        prompt: "Route to specialist",
      });

      const result = await mainAgent.run("Do specialist work", provider);
      expect(result).toBe("Specialist completed task");
      expect(callCount).toBe(2);
    });
  });

  describe("3. Agent with telemetry", () => {
    test("produces spans when telemetry enabled", async () => {
      let callCount = 0;

      const mockProvider: LLMProvider = {
        async chat(): Promise<LLMResponse> {
          callCount++;
          if (callCount === 1) {
            return {
              content: [
                { text: "Using echo", type: "text" },
                { input: { text: "hi" }, name: "echo", toolUseId: "t1", type: "tool_use" },
              ],
              stopReason: "tool_use",
              usage: { inputTokens: 15, outputTokens: 8 },
            };
          }
          return textResponse("Done");
        },
        async *chatStream() {},
        contextWindowSize: 200_000,
      };

      const echoParams = z.object({ text: z.string() });
      const def: AgentDef = {
        name: "traced-agent",
        prompt: "Test agent",
        telemetry: { enabled: true, serviceName: "test-service" },
        tools: [
          plugin({
            description: "Echo text",
            name: "echo",
            params: echoParams,
            run: async ({ text }: z.output<typeof echoParams>) => text,
          }),
        ],
      };

      const a = agent(def);
      const result = await a.run("Say hi", mockProvider);

      expect(result).toBe("Done");

      const spans = getRecordedSpans();
      expect(spans.length).toBeGreaterThanOrEqual(1);

      const agentSpan = spans.find((s) => s.name === "agent.run");
      expect(agentSpan).toBeDefined();
      expect(agentSpan!.attributes["agent.name"]).toBe("traced-agent");
      expect(agentSpan!.status).toBe("ok");

      const llmSpans = agentSpan!.children.filter((s) => s.name === "llm.call");
      expect(llmSpans.length).toBeGreaterThanOrEqual(1);
      expect(llmSpans[0].attributes["gen_ai.usage.input_tokens"]).toBeDefined();

      const toolSpans = agentSpan!.children.filter((s) => s.name === "tool.execute");
      expect(toolSpans.length).toBeGreaterThanOrEqual(1);
      expect(toolSpans[0].attributes["tool.name"]).toBe("echo");
    });

    test("no spans when telemetry disabled", async () => {
      const mockProvider: LLMProvider = {
        async chat(): Promise<LLMResponse> {
          return textResponse("Done");
        },
        async *chatStream() {},
        contextWindowSize: 200_000,
      };

      const def: AgentDef = {
        name: "untraced",
        prompt: "Test",
        telemetry: { enabled: false },
      };

      const a = agent(def);
      await a.run("Test", mockProvider);

      expect(getRecordedSpans()).toHaveLength(0);
    });

    test("no spans when telemetry undefined", async () => {
      const mockProvider: LLMProvider = {
        async chat(): Promise<LLMResponse> {
          return textResponse("Done");
        },
        async *chatStream() {},
        contextWindowSize: 200_000,
      };

      const a = agent({ name: "plain", prompt: "Test" });
      await a.run("Test", mockProvider);

      expect(getRecordedSpans()).toHaveLength(0);
    });
  });

  describe("4. All P7 exports importable", () => {
    test("all P7 types and functions are importable from barrel", async () => {
      const mod = await import("../../src/index");

      expect(mod.InMemoryProvider).toBeDefined();
      expect(mod.GuardrailError).toBeDefined();
      expect(mod.createMcpServer).toBeDefined();
      expect(mod.withSpan).toBeDefined();
      expect(mod.getRecordedSpans).toBeDefined();
      expect(mod.clearRecordedSpans).toBeDefined();
      expect(mod.addSpanAttributes).toBeDefined();
      expect(mod.agent).toBeDefined();
      expect(mod.plugin).toBeDefined();
      expect(mod.run).toBeDefined();
    });
  });

  describe("5. Telemetry with react-loop directly", () => {
    test("react loop creates llm.call and tool.execute spans", async () => {
      const events: Array<AgentEvent> = [];
      let callCount = 0;

      const mockProvider: LLMProvider = {
        async chat(): Promise<LLMResponse> {
          callCount++;
          if (callCount === 1) {
            return {
              content: [
                { text: "Calling tool", type: "text" },
                { input: {}, name: "helper", toolUseId: "t1", type: "tool_use" },
              ],
              stopReason: "tool_use",
              usage: { inputTokens: 10, outputTokens: 5 },
            };
          }
          return textResponse("Complete");
        },
        async *chatStream() {},
        contextWindowSize: 200_000,
      };

      const plugins = new Map<string, InternalPlugin>([["helper", makePlugin("helper")]]);
      const toolDefs: Array<ToolDef> = [
        {
          description: "A helper",
          inputSchema: { properties: {}, required: [], type: "object" },
          name: "helper",
        },
      ];

      await Effect.runPromise(
        runReactLoop(
          [{ content: [{ text: "test", type: "text" }], role: "user" }],
          toolDefs,
          plugins,
          mockProvider,
          defaultConfig,
          new Set(),
          undefined,
          makeEmit(events),
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { enabled: true }
        )
      );

      const spans = getRecordedSpans();
      const llmSpans = spans.filter((s) => s.name === "llm.call");
      expect(llmSpans.length).toBeGreaterThanOrEqual(1);

      const toolSpans = spans.filter((s) => s.name === "tool.execute");
      expect(toolSpans.length).toBeGreaterThanOrEqual(1);
    });
  });
});
