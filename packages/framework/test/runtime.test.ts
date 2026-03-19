import { describe, expect, test } from "bun:test";
import { graph } from "../src/graph/builder";
import { run } from "../src/runtime";
import type { LLMProvider, LLMResponse } from "../src/types";

// --- Mock provider ---

function mockProvider(): LLMProvider {
  return {
    chat: async (messages) => {
      const userText = messages
        .filter((m) => m.role === "user")
        .flatMap((m) => m.content)
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string; type: "text" }).text)
        .join("");

      return {
        content: [{ text: `echo:${userText.slice(0, 20)}`, type: "text" as const }],
        stopReason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 10 },
      } satisfies LLMResponse;
    },
    chatStream: async function* () {},
    contextWindowSize: 200_000,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("run()", () => {
  test("returns GraphResult for simple graph", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [
        {
          executor: { name: "agent-A", prompt: "Hello" },
          id: "A",
        },
      ],
      provider: mockProvider(),
    });

    const result = await run(g);

    expect(result.status).toBe("Complete");
    expect(result.results.A).toBeDefined();
    expect(result.results.A.status).toBe("Complete");
  });

  test("delegates to executeGraph", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [
        {
          executor: async () => "direct-output",
          id: "A",
        },
      ],
      provider: mockProvider(),
    });

    const result = await run(g);

    expect(result.status).toBe("Complete");
    expect(result.results.A.output).toBe("direct-output");
  });
});
