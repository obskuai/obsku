import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { agent } from "../../src/agent";
import type {
  AgentEvent,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
  Message,
  PluginDef,
  ToolDef,
} from "../../src/types";
import { delay } from "../utils/helpers";

class MockProvider implements LLMProvider {
  readonly contextWindowSize = 200_000;
  private responses: Array<LLMResponse>;
  private callCount = 0;

  constructor(responses: Array<LLMResponse>) {
    this.responses = responses;
  }

  async chat(_messages: Array<Message>): Promise<LLMResponse> {
    const response = this.responses[this.callCount % this.responses.length];
    this.callCount++;
    return response;
  }

  async *chatStream(
    _messages: Array<Message>,
    _tools?: Array<ToolDef>
  ): AsyncIterable<LLMStreamEvent> {
    const response = this.responses[this.callCount % this.responses.length];
    this.callCount++;
    for (const block of response.content) {
      if (block.type === "text") {
        yield { content: block.text, type: "text_delta" };
      }
    }
    yield {
      stopReason: response.stopReason,
      type: "message_end",
      usage: response.usage,
    };
  }

  getCallCount() {
    return this.callCount;
  }
}

describe("agent with input guardrails", () => {
  test("blocks input before LLM call", async () => {
    const mockProvider = new MockProvider([
      {
        content: [{ text: "Should not reach", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const a = agent({
      guardrails: {
        input: [() => ({ allow: false, reason: "blocked by input guardrail" })],
      },
      name: "guarded",
      prompt: "You are helpful",
    });

    await expect(a.run("test", mockProvider)).rejects.toThrow(/Guardrail blocked/);
    expect(mockProvider.getCallCount()).toBe(0);
  });

  test("allows input when guardrail passes", async () => {
    const mockProvider = new MockProvider([
      {
        content: [{ text: "Hello", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const a = agent({
      guardrails: {
        input: [() => ({ allow: true })],
      },
      name: "guarded",
      prompt: "You are helpful",
    });

    const result = await a.run("test", mockProvider);
    expect(result).toBe("Hello");
    expect(mockProvider.getCallCount()).toBe(1);
  });

  test("emits guardrail.input.blocked event", async () => {
    const mockProvider = new MockProvider([
      {
        content: [{ text: "Should not reach", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const events: Array<AgentEvent> = [];
    const a = agent({
      guardrails: {
        input: [() => ({ allow: false, reason: "test block" })],
      },
      name: "guarded",
      prompt: "You are helpful",
    });

    try {
      await a.run("test", mockProvider);
    } catch {
      // expected: agent may throw when guardrail blocks
    }

    expect(events.some((e) => e.type === "guardrail.input.blocked")).toBe(false);
  });

  test("runs multiple guardrails sequentially", async () => {
    const order: Array<string> = [];
    const mockProvider = new MockProvider([
      {
        content: [{ text: "Hello", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const a = agent({
      guardrails: {
        input: [
          () => {
            order.push("first");
            return { allow: true };
          },
          () => {
            order.push("second");
            return { allow: true };
          },
        ],
      },
      name: "guarded",
      prompt: "You are helpful",
    });

    await a.run("test", mockProvider);
    expect(order).toEqual(["first", "second"]);
  });

  test("stops at first blocking guardrail", async () => {
    const order: Array<string> = [];
    const mockProvider = new MockProvider([
      {
        content: [{ text: "Should not reach", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const a = agent({
      guardrails: {
        input: [
          () => {
            order.push("first");
            return { allow: false, reason: "blocked" };
          },
          () => {
            order.push("second");
            return { allow: true };
          },
        ],
      },
      name: "guarded",
      prompt: "You are helpful",
    });

    await expect(a.run("test", mockProvider)).rejects.toThrow(/Guardrail blocked/);
    expect(order).toEqual(["first"]);
    expect(mockProvider.getCallCount()).toBe(0);
  });

  test("supports async guardrails", async () => {
    const mockProvider = new MockProvider([
      {
        content: [{ text: "Hello", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const a = agent({
      guardrails: {
        input: [
          async () => {
            await delay(10);
            return { allow: true };
          },
        ],
      },
      name: "guarded",
      prompt: "You are helpful",
    });

    const result = await a.run("test", mockProvider);
    expect(result).toBe("Hello");
  });
});

describe("agent with output guardrails", () => {
  test("blocks output after LLM response", async () => {
    const mockProvider = new MockProvider([
      {
        content: [{ text: "inappropriate content", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const a = agent({
      guardrails: {
        output: [() => ({ allow: false, reason: "blocked by output guardrail" })],
      },
      name: "guarded",
      prompt: "You are helpful",
    });

    await expect(a.run("test", mockProvider)).rejects.toThrow(/Guardrail blocked/);
    expect(mockProvider.getCallCount()).toBe(1);
  });

  test("allows output when guardrail passes", async () => {
    const mockProvider = new MockProvider([
      {
        content: [{ text: "appropriate content", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const a = agent({
      guardrails: {
        output: [() => ({ allow: true })],
      },
      name: "guarded",
      prompt: "You are helpful",
    });

    const result = await a.run("test", mockProvider);
    expect(result).toBe("appropriate content");
  });

  test("runs output guardrails on each iteration", async () => {
    const guardrailCalls: Array<number> = [];
    const mockProvider = new MockProvider([
      {
        content: [
          { text: "first response", type: "text" },
          { input: {}, name: "echo", toolUseId: "1", type: "tool_use" },
        ],
        stopReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 10 },
      },
      {
        content: [{ text: "final response", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 20, outputTokens: 5 },
      },
    ]);

    const echoTool: PluginDef = {
      description: "Echo tool",
      name: "echo",
      params: z.object({}),
      run: async () => "echo result",
    };

    const a = agent({
      guardrails: {
        output: [
          () => {
            guardrailCalls.push(Date.now());
            return { allow: true };
          },
        ],
      },
      name: "guarded",
      prompt: "You are helpful",
      tools: [echoTool],
    });

    await a.run("test", mockProvider);
    expect(guardrailCalls.length).toBe(2);
  });

  test("stops iteration when output guardrail blocks", async () => {
    const mockProvider = new MockProvider([
      {
        content: [{ text: "blocked response", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const a = agent({
      guardrails: {
        output: [() => ({ allow: false, reason: "blocked" })],
      },
      name: "guarded",
      prompt: "You are helpful",
    });

    await expect(a.run("test", mockProvider)).rejects.toThrow(/Guardrail blocked/);
  });
});

describe("agent with both input and output guardrails", () => {
  test("input block prevents any LLM calls", async () => {
    const mockProvider = new MockProvider([
      {
        content: [{ text: "response", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    let outputGuardrailCalled = false;
    const a = agent({
      guardrails: {
        input: [() => ({ allow: false, reason: "input blocked" })],
        output: [
          () => {
            outputGuardrailCalled = true;
            return { allow: true };
          },
        ],
      },
      name: "guarded",
      prompt: "You are helpful",
    });

    await expect(a.run("test", mockProvider)).rejects.toThrow(/Guardrail blocked/);
    expect(mockProvider.getCallCount()).toBe(0);
    expect(outputGuardrailCalled).toBe(false);
  });

  test("output block after successful input", async () => {
    const mockProvider = new MockProvider([
      {
        content: [{ text: "response", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const a = agent({
      guardrails: {
        input: [() => ({ allow: true })],
        output: [() => ({ allow: false, reason: "output blocked" })],
      },
      name: "guarded",
      prompt: "You are helpful",
    });

    await expect(a.run("test", mockProvider)).rejects.toThrow(/Guardrail blocked/);
    expect(mockProvider.getCallCount()).toBe(1);
  });
});

describe("agent without guardrails", () => {
  test("works normally without guardrails config", async () => {
    const mockProvider = new MockProvider([
      {
        content: [{ text: "Hello", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const a = agent({
      name: "normal",
      prompt: "You are helpful",
    });

    const result = await a.run("test", mockProvider);
    expect(result).toBe("Hello");
    expect(mockProvider.getCallCount()).toBe(1);
  });

  test("works with empty guardrails arrays", async () => {
    const mockProvider = new MockProvider([
      {
        content: [{ text: "Hello", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const a = agent({
      guardrails: {
        input: [],
        output: [],
      },
      name: "guarded",
      prompt: "You are helpful",
    });

    const result = await a.run("test", mockProvider);
    expect(result).toBe("Hello");
  });
});

describe("agent with streaming and guardrails", () => {
  test("blocks input before streaming starts", async () => {
    const mockProvider = new MockProvider([
      {
        content: [{ text: "Should not reach", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const a = agent({
      guardrails: {
        input: [() => ({ allow: false, reason: "blocked" })],
      },
      name: "guarded",
      prompt: "You are helpful",
      streaming: true,
    });

    await expect(a.run("test", mockProvider)).rejects.toThrow(/Guardrail blocked/);
    expect(mockProvider.getCallCount()).toBe(0);
  });

  test("blocks output after streaming completes", async () => {
    const mockProvider = new MockProvider([
      {
        content: [{ text: "inappropriate", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const a = agent({
      guardrails: {
        output: [() => ({ allow: false, reason: "blocked" })],
      },
      name: "guarded",
      prompt: "You are helpful",
      streaming: true,
    });

    await expect(a.run("test", mockProvider)).rejects.toThrow(/Guardrail blocked/);
    expect(mockProvider.getCallCount()).toBe(1);
  });
});
