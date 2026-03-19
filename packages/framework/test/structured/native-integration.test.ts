import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { agent } from "../../src/agent";
import { structuredAgent } from "../../src/structured";
import type { ChatOptions, LLMProvider, LLMResponse, ResponseFormat } from "../../src/types";

/**
 * Mock provider that captures the responseFormat passed to chat()
 */
function createMockProviderWithCapture(
  response: string,
  capture: { responseFormat?: ResponseFormat }
): LLMProvider {
  return {
    async chat(
      _messages: Array<unknown>,
      _tools?: Array<unknown>,
      options?: ChatOptions
    ): Promise<LLMResponse> {
      capture.responseFormat = options?.responseFormat;
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

describe("structuredAgent native responseFormat integration", () => {
  const schema = z.object({
    name: z.string(),
    score: z.number(),
  });

  test("structuredAgent.run() passes responseFormat to provider.chat()", async () => {
    const capture: { responseFormat?: ResponseFormat } = {};
    const provider = createMockProviderWithCapture('{"name": "Alice", "score": 95}', capture);

    const sa = structuredAgent({
      name: "test",
      output: schema,
      prompt: "Generate a test result",
    });

    await sa.run("Test input", provider);

    expect(capture.responseFormat).toBeDefined();
    expect(capture.responseFormat?.type).toBe("json_schema");
    expect(capture.responseFormat?.jsonSchema.schema).toBeDefined();
    expect(capture.responseFormat?.jsonSchema.name).toBe("test");
  });

  test("responseFormat schema matches Zod schema conversion", async () => {
    const capture: { responseFormat?: ResponseFormat } = {};
    const provider = createMockProviderWithCapture('{"name": "Bob", "score": 85}', capture);

    const sa = structuredAgent({
      name: "scored-item",
      output: schema,
      prompt: "Generate a test result",
    });

    await sa.run("Test input", provider);

    const jsonSchema = capture.responseFormat?.jsonSchema.schema as Record<string, unknown>;
    // Should have type: object and properties matching schema
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.properties).toBeDefined();
    expect((jsonSchema.properties as Record<string, unknown>).name).toBeDefined();
    expect((jsonSchema.properties as Record<string, unknown>).score).toBeDefined();
  });

  test("Zod validateOutput() runs on native JSON output", async () => {
    const capture: { responseFormat?: ResponseFormat } = {};
    const provider = createMockProviderWithCapture('{"name": "Charlie", "score": 90}', capture);

    const sa = structuredAgent({
      name: "test",
      output: schema,
      prompt: "Generate a test result",
    });

    const result = await sa.run("Test input", provider);

    // Should be validated and typed
    expect(result).toEqual({ name: "Charlie", score: 90 });
    expect(capture.responseFormat).toBeDefined();
  });

  test("Zod validateOutput() runs on markdown-wrapped fallback output", async () => {
    const capture: { responseFormat?: ResponseFormat } = {};
    const provider = createMockProviderWithCapture(
      '```json\n{"name": "Dave", "score": 88}\n```',
      capture
    );

    const sa = structuredAgent({
      name: "test",
      output: schema,
      prompt: "Generate a test result",
    });

    const result = await sa.run("Test input", provider);

    // Should extract JSON from markdown and validate
    expect(result).toEqual({ name: "Dave", score: 88 });
  });

  test("retry loop triggers on Zod validation failure", async () => {
    let callCount = 0;
    const capture: { responseFormat?: ResponseFormat } = {};

    const provider: LLMProvider = {
      async chat(
        _messages: Array<unknown>,
        _tools?: Array<unknown>,
        options?: ChatOptions
      ): Promise<LLMResponse> {
        capture.responseFormat = options?.responseFormat;
        callCount++;
        // First call returns invalid JSON, second returns valid
        const response = callCount === 1 ? "not valid json" : '{"name": "Eve", "score": 92}';
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

    const sa = structuredAgent({
      maxRetries: 2,
      name: "test",
      output: schema,
      prompt: "Generate a test result",
    });

    const result = await sa.run("Test input", provider);

    expect(callCount).toBe(2);
    expect(result).toEqual({ name: "Eve", score: 92 });
  });

  test("prompt injection is still present in structured agent", async () => {
    const capture: { lastMessages?: Array<unknown> } = {};

    const provider: LLMProvider = {
      async chat(messages: Array<unknown>): Promise<LLMResponse> {
        capture.lastMessages = messages;
        return {
          content: [{ text: '{"name": "Frank", "score": 80}', type: "text" }],
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

    const sa = structuredAgent({
      name: "test",
      output: schema,
      prompt: "Generate a test result",
    });

    await sa.run("Test input", provider);

    // Check that messages contain the schema instruction
    const messagesStr = JSON.stringify(capture.lastMessages);
    expect(messagesStr).toContain("CRITICAL");
    expect(messagesStr).toContain("valid JSON");
    expect(messagesStr).toContain("schema");
  });

  test("base agent.run() accepts responseFormat in options", async () => {
    const capture: { responseFormat?: ResponseFormat } = {};

    const provider: LLMProvider = {
      async chat(
        _messages: Array<unknown>,
        _tools?: Array<unknown>,
        options?: ChatOptions
      ): Promise<LLMResponse> {
        capture.responseFormat = options?.responseFormat;
        return {
          content: [{ text: '{"result": "ok"}', type: "text" }],
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

    const testAgent = agent({
      name: "base-test",
      prompt: "Return JSON",
    });

    const responseFormat: ResponseFormat = {
      jsonSchema: {
        name: "test-output",
        schema: { properties: { result: { type: "string" } }, type: "object" },
      },
      type: "json_schema",
    };

    await testAgent.run("Test", provider, { responseFormat });

    expect(capture.responseFormat).toEqual(responseFormat);
  });
});
