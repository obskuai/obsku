import { z } from "zod";
import { describe, expect, test } from "bun:test";
import { agent } from "../../src/agent";
import { plugin } from "../../src/plugin";
import type { LLMProvider, LLMResponse, Message, PluginDef } from "../../src/types";
import { delay, dummyStream } from "../utils/helpers";

describe("agent() factory", () => {
  test("creates agent with name and run method", () => {
    const a = agent({
      name: "test-agent",
      prompt: "You are a test agent",
    });

    expect(a.name).toBe("test-agent");
    expect(typeof a.run).toBe("function");
  });

  test("run() calls provider.chat with messages and returns text response", async () => {
    const mockResponse: LLMResponse = {
      content: [{ text: "Hello from agent", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    const mockProvider: LLMProvider = {
      chat: async (_messages: Array<Message>) => mockResponse,
      chatStream: async function* (_messages: Array<Message>) {
        yield { content: "Hello", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "greeter",
      prompt: "You are a greeter",
    });

    const result = await a.run("Say hello", mockProvider);
    expect(result).toBe("Hello from agent");
  });

  test("run() concatenates multiple text blocks", async () => {
    const mockResponse: LLMResponse = {
      content: [
        { text: "First part. ", type: "text" },
        { text: "Second part.", type: "text" },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 8 },
    };

    const mockProvider: LLMProvider = {
      chat: async (_messages: Array<Message>) => mockResponse,
      chatStream: async function* (_messages: Array<Message>) {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "concatenator",
      prompt: "You concatenate",
    });

    const result = await a.run("Test", mockProvider);
    expect(result).toBe("First part. Second part.");
  });

  test("run() filters out non-text content blocks", async () => {
    const mockResponse: LLMResponse = {
      content: [
        { text: "Answer: ", type: "text" },
        { input: {}, name: "calc", toolUseId: "1", type: "tool_use" },
        { text: "42", type: "text" },
      ],
      stopReason: "tool_use",
      usage: { inputTokens: 15, outputTokens: 10 },
    };

    const mockProvider: LLMProvider = {
      chat: async (_messages: Array<Message>) => mockResponse,
      chatStream: async function* (_messages: Array<Message>) {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "filterer",
      prompt: "You filter",
    });

    const result = await a.run("Calculate", mockProvider);
    expect(result).toBe("Answer: 42");
  });
});

describe("agent tool execution", () => {
  const echoTool = {
    description: "Echoes input",
    name: "echo",
    params: z.object({ text: z.string().describe("text to echo") }),
    run: async (input) => ({ echoed: input.text }),
  };

  const uppercaseTool = {
    description: "Uppercases text",
    name: "uppercase",
    params: z.object({ text: z.string().describe("text") }),
    run: async (input) => ({ result: String(input.text).toUpperCase() }),
  };

  const internalEchoTool = plugin({
    description: "Echoes input via internal plugin",
    name: "internal-echo",
    params: z.object({ text: z.string().describe("text to echo") }),
    run: async (input) => ({ echoed: input.text }),
  });

  test("executes 1 tool, feeds result back, gets final answer", async () => {
    let callCount = 0;

    const mockProvider: LLMProvider = {
      chat: async (_messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [{ input: { text: "hi" }, name: "echo", toolUseId: "t1", type: "tool_use" }],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        return {
          content: [{ text: "Tool said: hi", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 20, outputTokens: 10 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({ name: "tool-agent", prompt: "Use tools", tools: [echoTool] });
    const result = await a.run("echo hi", mockProvider);

    expect(result).toBe("Tool said: hi");
    expect(callCount).toBe(2);
  });

  test("accepts internal plugin tools in agent defs", async () => {
    let callCount = 0;

    const mockProvider: LLMProvider = {
      chat: async (_messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [
              {
                input: { text: "hi" },
                name: "internal-echo",
                toolUseId: "t1",
                type: "tool_use",
              },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        return {
          content: [{ text: "Tool said: hi", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 20, outputTokens: 10 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "internal-tool-agent",
      prompt: "Use tools",
      tools: [internalEchoTool],
    });
    const result = await a.run("echo hi", mockProvider);

    expect(result).toBe("Tool said: hi");
    expect(callCount).toBe(2);
  });

  test("executes 2 tools in sequence across iterations", async () => {
    let callCount = 0;

    const mockProvider: LLMProvider = {
      chat: async (_messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [
              { input: { text: "hello" }, name: "echo", toolUseId: "t1", type: "tool_use" },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        if (callCount === 2) {
          return {
            content: [
              { input: { text: "hello" }, name: "uppercase", toolUseId: "t2", type: "tool_use" },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 20, outputTokens: 5 },
          };
        }
        return {
          content: [{ text: "HELLO", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 30, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "multi-tool",
      prompt: "Use tools",
      tools: [echoTool, uppercaseTool],
    });
    const result = await a.run("process hello", mockProvider);

    expect(result).toBe("HELLO");
    expect(callCount).toBe(3);
  });

  test("stops after max iterations and returns last text", async () => {
    let callCount = 0;

    const mockProvider: LLMProvider = {
      chat: async (_messages: Array<Message>) => {
        callCount++;
        return {
          content: [
            { text: `iteration ${callCount}`, type: "text" },
            { input: { text: "loop" }, name: "echo", toolUseId: `t${callCount}`, type: "tool_use" },
          ],
          stopReason: "tool_use" as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      chatStream: dummyStream,
      contextWindowSize: 200_000,
    };

    const a = agent({ name: "looper", prompt: "Loop forever", tools: [echoTool] });
    const result = await a.run("go", mockProvider);

    expect(callCount).toBe(10);
    expect(result).toBe("iteration 10");
  });
});

test("parallel execution: 3 tools complete in < 800ms (not 1500ms sequential)", async () => {
  const slowTool1 = {
    description: "Slow tool 1",
    name: "slow1",
    params: z.object({}),
    run: async () => {
      await delay(500);
      return "result1";
    },
  };

  const slowTool2 = {
    description: "Slow tool 2",
    name: "slow2",
    params: z.object({}),
    run: async () => {
      await delay(500);
      return "result2";
    },
  };

  const slowTool3 = {
    description: "Slow tool 3",
    name: "slow3",
    params: z.object({}),
    run: async () => {
      await delay(500);
      return "result3";
    },
  };

  const agentDef: { name: string; prompt: string; tools: Array<PluginDef> } = {
    name: "parallel-agent",
    prompt: "Test",
    tools: [slowTool1, slowTool2, slowTool3],
  };
  const agentInstance = agent(agentDef);

  let callCount = 0;
  const mockProvider: LLMProvider = {
    chat: async () => {
      callCount++;
      if (callCount === 1) {
        // First call: return all 3 tool calls
        return {
          content: [
            { input: {}, name: "slow1", toolUseId: "1", type: "tool_use" },
            { input: {}, name: "slow2", toolUseId: "2", type: "tool_use" },
            { input: {}, name: "slow3", toolUseId: "3", type: "tool_use" },
          ],
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 10 },
        };
      }
      // Second call: final answer
      return {
        content: [{ text: "All done!", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
    chatStream: async function* () {
      yield { content: "test", type: "text_delta" };
    },
    contextWindowSize: 200_000,
  };

  const start = Date.now();
  const result = await agentInstance.run("parallel test", mockProvider);
  const duration = Date.now() - start;

  expect(result).toBe("All done!");
  expect(callCount).toBe(2);
  // Parallel: ~500ms (all run at once) + overhead
  // Sequential would be: ~1500ms (500*3)
  expect(duration).toBeLessThan(800);
});
