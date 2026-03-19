import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { type AgentDef, agent, plugin } from "../../src";
import type { LLMProvider, LLMResponse, Message, ToolDef } from "../../src/types";

const echoTool = plugin({
  description: "Echo the input",
  name: "echo",
  params: z.object({ text: z.string().describe("text to echo") }),
  run: async (input) => ({ echoed: input.text }),
});

function makeProvider(responses: Array<LLMResponse>): LLMProvider {
  let index = 0;
  return {
    chat: async (_messages: Array<Message>, _tools?: Array<ToolDef>) => {
      const response = responses[index++] ?? {
        content: [{ text: "done", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
      return response;
    },
    chatStream: async function* () {
      yield { content: "", type: "text_delta" };
    },
    contextWindowSize: 200_000,
  };
}

describe("handoff", () => {
  test("single handoff - agent A transfers to agent B", async () => {
    const specialistDef: AgentDef = {
      name: "specialist",
      prompt: "You are a specialist. Return 'specialist-result'.",
      tools: [],
    };

    const routerAgent = agent({
      handoffs: [
        {
          agent: specialistDef,
          description: "Transfer to specialist for complex tasks",
        },
      ],
      name: "router",
      prompt: "Route to specialist when needed.",
      tools: [echoTool],
    });

    const provider = makeProvider([
      {
        content: [
          { text: "Routing to specialist", type: "text" },
          {
            input: {},
            name: "transfer_to_specialist",
            toolUseId: "t1",
            type: "tool_use",
          },
        ],
        stopReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        content: [{ text: "specialist-result", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const result = await routerAgent.run("test input", provider);

    expect(result).toBe("specialist-result");
  });

  test("handoff with message context - target agent receives conversation", async () => {
    const specialistDef: AgentDef = {
      name: "context_specialist",
      prompt: "You receive context from previous conversation.",
      tools: [],
    };

    const routerAgent = agent({
      handoffs: [
        {
          agent: specialistDef,
          description: "Transfer with full context",
        },
      ],
      name: "context_router",
      prompt: "Route with context.",
      tools: [],
    });

    let callCount = 0;
    let specialistReceivedMessages: Array<Message> = [];
    const provider: LLMProvider = {
      chat: async (messages: Array<Message>, _tools?: Array<ToolDef>) => {
        callCount++;
        if (callCount === 2) {
          specialistReceivedMessages = messages;
          return {
            content: [{ text: "context-received", type: "text" }],
            stopReason: "end_turn",
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        if (callCount === 1) {
          return {
            content: [
              { text: "Routing", type: "text" },
              {
                input: {},
                name: "transfer_to_context_specialist",
                toolUseId: "t1",
                type: "tool_use",
              },
            ],
            stopReason: "tool_use",
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        return {
          content: [{ text: "fallback", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      chatStream: async function* () {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const result = await routerAgent.run("original input", provider);

    expect(result).toBe("context-received");
    expect(specialistReceivedMessages.length).toBeGreaterThan(0);
    const hasUserMessage = specialistReceivedMessages.some(
      (m) => m.role === "user" && m.content.some((c) => c.type === "text")
    );
    expect(hasUserMessage).toBe(true);
  });

  test("no handoffs - backward compatibility", async () => {
    const regularAgent = agent({
      name: "regular",
      prompt: "Regular agent without handoffs.",
      tools: [echoTool],
    });

    const provider = makeProvider([
      {
        content: [
          { text: "Using echo", type: "text" },
          {
            input: { text: "hello" },
            name: "echo",
            toolUseId: "t1",
            type: "tool_use",
          },
        ],
        stopReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        content: [{ text: "done", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const result = await regularAgent.run("test", provider);

    expect(result).toBe("done");
  });

  test("multiple handoff targets - correct one selected", async () => {
    const specialistA: AgentDef = {
      name: "specialist_a",
      prompt: "Specialist A.",
      tools: [],
    };

    const specialistB: AgentDef = {
      name: "specialist_b",
      prompt: "Specialist B.",
      tools: [],
    };

    const routerAgent = agent({
      handoffs: [
        {
          agent: specialistA,
          description: "Transfer to specialist A for task A",
        },
        {
          agent: specialistB,
          description: "Transfer to specialist B for task B",
        },
      ],
      name: "multi_router",
      prompt: "Route to appropriate specialist.",
      tools: [],
    });

    const provider = makeProvider([
      {
        content: [
          { text: "Routing to B", type: "text" },
          {
            input: {},
            name: "transfer_to_specialist_b",
            toolUseId: "t1",
            type: "tool_use",
          },
        ],
        stopReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        content: [{ text: "result-from-b", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);

    const result = await routerAgent.run("test", provider);

    expect(result).toBe("result-from-b");
  });
});
