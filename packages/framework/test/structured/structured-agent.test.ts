import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { structuredAgent } from "../../src/structured";
import type { LLMProvider, LLMResponse } from "../../src/types";

function createMockProvider(responses: Array<string>): LLMProvider {
  let callCount = 0;
  return {
    async chat(): Promise<LLMResponse> {
      const fallbackResponse = responses.length > 0 ? responses.at(-1) : "{}";
      const response = responses[callCount] ?? fallbackResponse;
      callCount++;
      return {
        content: [{ text: response, type: "text" }],
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
}

describe("structuredAgent", () => {
  const schema = z.object({
    name: z.string(),
    score: z.number(),
  });

  test("returns typed output on valid response", async () => {
    const provider = createMockProvider(['{"name": "Alice", "score": 95}']);
    const agent = structuredAgent({
      name: "test",
      output: schema,
      prompt: "Generate a test result",
    });

    const result = await agent.run("Test input", provider);
    expect(result).toEqual({ name: "Alice", score: 95 });
  });

  test("retries on validation failure", async () => {
    const provider = createMockProvider(['{"name": "Bob"}', '{"name": "Bob", "score": 85}']);
    const agent = structuredAgent({
      maxRetries: 2,
      name: "test",
      output: schema,
      prompt: "Generate a test result",
    });

    const result = await agent.run("Test input", provider);
    expect(result).toEqual({ name: "Bob", score: 85 });
  });

  test("throws after max retries", async () => {
    const provider = createMockProvider(['{"name": "Charlie"}', '{"name": "Charlie"}']);
    const agent = structuredAgent({
      maxRetries: 1,
      name: "test",
      output: schema,
      prompt: "Generate a test result",
    });

    try {
      await agent.run("Test input", provider);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  test("handles markdown code blocks", async () => {
    const provider = createMockProvider(['```json\n{"name": "Dave", "score": 90}\n```']);
    const agent = structuredAgent({
      name: "test",
      output: schema,
      prompt: "Generate a test result",
    });

    const result = await agent.run("Test input", provider);
    expect(result).toEqual({ name: "Dave", score: 90 });
  });

  test("retries on invalid json before succeeding", async () => {
    const provider = createMockProvider(["not json", '{"name": "Eve", "score": 91}']);
    const agent = structuredAgent({
      maxRetries: 2,
      name: "test",
      output: schema,
      prompt: "Generate a test result",
    });

    const result = await agent.run("Test input", provider);

    expect(result).toEqual({ name: "Eve", score: 91 });
  });

  test("throws structured error after invalid json exhausts retries", async () => {
    const provider = createMockProvider(["not json", "still not json"]);
    const agent = structuredAgent({
      maxRetries: 1,
      name: "test",
      output: schema,
      prompt: "Generate a test result",
    });

    try {
      await agent.run("Test input", provider);
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain('JSON Parse error: Unexpected identifier "still"');
    }
  });
});
