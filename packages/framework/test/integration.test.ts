import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { agent, graph, plugin, run } from "../src/index";
import type { AgentDef, LLMProvider } from "../src/types";
import { mockLLMProvider } from "./utils/mock-llm-provider";

describe("Framework Integration", () => {
  test("run() executes agent nodes directly via public graph API", async () => {
    const params = z.object({ text: z.string() });
    const echo = plugin({
      description: "Echo input",
      name: "echo",
      params,
      run: async (input: z.output<typeof params>) => `ECHO: ${input.text}`,
    });

    const testAgent: AgentDef = {
      name: "test-agent",
      prompt: "You are a test agent",
      tools: [echo],
    };

    const provider = mockLLMProvider();
    const testGraph = graph({
      edges: [],
      entry: "test-node",
      nodes: [
        {
          description: "Test",
          executor: testAgent,
          id: "test-node",
        },
      ],
      provider,
    });

    const result = await run(testGraph, { input: "Say hello" });

    expect(result.status).toBe("Complete");
    expect(result.results["test-node"]).toBeDefined();
    expect(result.results["test-node"].status).toBe("Complete");
    expect(result.results["test-node"].output).toBe(
      "Based on the tool results, the scan reveals open ports on the target."
    );
  });

  test("provider swappability: different providers work", async () => {
    let call1Count = 0;
    let call2Count = 0;

    const provider1: LLMProvider = {
      chat: async (_messages) => {
        call1Count++;
        return {
          content: [{ text: "Provider 1", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 10 },
        };
      },
      chatStream: async function* (_messages) {
        yield { content: "Provider 1", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const provider2: LLMProvider = {
      chat: async (_messages) => {
        call2Count++;
        return {
          content: [{ text: "Provider 2", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 10 },
        };
      },
      chatStream: async function* (_messages) {
        yield { content: "Provider 2", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const simpleAgent = agent({ name: "simple", prompt: "Test" });

    const g1 = graph({
      edges: [],
      entry: "n",
      nodes: [
        {
          description: "Test",
          executor: async (input: unknown) => simpleAgent.run(input as string, provider1),
          id: "n",
        },
      ],
      provider: provider1,
    });

    const g2 = graph({
      edges: [],
      entry: "n",
      nodes: [
        {
          description: "Test",
          executor: async (input: unknown) => simpleAgent.run(input as string, provider2),
          id: "n",
        },
      ],
      provider: provider2,
    });

    await run(g1);
    await run(g2);

    // Each provider called once (proves swappability)
    expect(call1Count).toBe(1);
    expect(call2Count).toBe(1);
  });
});
