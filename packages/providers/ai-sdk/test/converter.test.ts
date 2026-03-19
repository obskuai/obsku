// Unit tests for converter.ts
// Tests toAiSdkMessages, toAiSdkTools, fromAiSdkResponse

import { describe, expect, test } from "bun:test";
import { BlockType, type Message, type ToolDef } from "@obsku/framework";
import type { GenerateTextResult, LanguageModelUsage, ToolSet } from "ai";
import { fromAiSdkResponse, toAiSdkMessages, toAiSdkTools } from "../src/converter";

function usage(partial?: Partial<LanguageModelUsage>): LanguageModelUsage {
  return {
    completionTokens: partial?.completionTokens ?? 0,
    promptTokens: partial?.promptTokens ?? 0,
    totalTokens:
      partial?.totalTokens ?? (partial?.promptTokens ?? 0) + (partial?.completionTokens ?? 0),
  };
}

function asContentArray(value: unknown): Array<Record<string, unknown>> {
  return value as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// toAiSdkMessages - System message extraction
// ---------------------------------------------------------------------------
describe("toAiSdkMessages", () => {
  describe("system message extraction", () => {
    test("extracts single system message", () => {
      const messages: Array<Message> = [
        { role: "system", content: [{ type: BlockType.TEXT, text: "You are helpful" }] },
        { role: "user", content: [{ type: BlockType.TEXT, text: "Hello" }] },
      ];
      const result = toAiSdkMessages(messages);
      expect(result.system).toBe("You are helpful");
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
    });

    test("extracts multiple system messages and joins with double newline", () => {
      const messages: Array<Message> = [
        { role: "system", content: [{ type: BlockType.TEXT, text: "You are helpful" }] },
        { role: "system", content: [{ type: BlockType.TEXT, text: "Be concise" }] },
        { role: "user", content: [{ type: BlockType.TEXT, text: "Hello" }] },
      ];
      const result = toAiSdkMessages(messages);
      expect(result.system).toBe("You are helpful\n\nBe concise");
      expect(result.messages).toHaveLength(1);
    });

    test("returns undefined system when no system messages", () => {
      const messages: Array<Message> = [
        { role: "user", content: [{ type: BlockType.TEXT, text: "Hello" }] },
        { role: "assistant", content: [{ type: BlockType.TEXT, text: "Hi there" }] },
      ];
      const result = toAiSdkMessages(messages);
      expect(result.system).toBeUndefined();
      expect(result.messages).toHaveLength(2);
    });

    test("filters empty system message text", () => {
      const messages: Array<Message> = [
        { role: "system", content: [{ type: BlockType.TEXT, text: "   " }] },
        { role: "user", content: [{ type: BlockType.TEXT, text: "Hello" }] },
      ];
      const result = toAiSdkMessages(messages);
      expect(result.system).toBeUndefined();
    });

    test("filters whitespace-only system message text", () => {
      const messages: Array<Message> = [
        { role: "system", content: [{ type: BlockType.TEXT, text: "" }] },
        { role: "user", content: [{ type: BlockType.TEXT, text: "Hello" }] },
      ];
      const result = toAiSdkMessages(messages);
      expect(result.system).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // toAiSdkMessages - TextContent conversion
  // ---------------------------------------------------------------------------
  describe("TextContent conversion", () => {
    test("converts user text message", () => {
      const messages: Array<Message> = [
        { role: "user", content: [{ type: BlockType.TEXT, text: "Hello world" }] },
      ];
      const result = toAiSdkMessages(messages);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "user",
        content: "Hello world",
      });
    });

    test("converts assistant text message", () => {
      const messages: Array<Message> = [
        { role: "assistant", content: [{ type: BlockType.TEXT, text: "Hi there" }] },
      ];
      const result = toAiSdkMessages(messages);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "assistant",
        content: "Hi there",
      });
    });

    test("joins multiple text blocks with newline", () => {
      const messages: Array<Message> = [
        {
          role: "user",
          content: [
            { type: BlockType.TEXT, text: "Line 1" },
            { type: BlockType.TEXT, text: "Line 2" },
          ],
        },
      ];
      const result = toAiSdkMessages(messages);
      expect(result.messages[0].content).toBe("Line 1\nLine 2");
    });

    test("filters empty text blocks", () => {
      const messages: Array<Message> = [
        {
          role: "user",
          content: [
            { type: BlockType.TEXT, text: "Hello" },
            { type: BlockType.TEXT, text: "   " },
            { type: BlockType.TEXT, text: "" },
          ],
        },
      ];
      const result = toAiSdkMessages(messages);
      expect(result.messages[0].content).toBe("Hello");
    });

    test("skips message with only empty text blocks", () => {
      const messages: Array<Message> = [
        { role: "user", content: [{ type: BlockType.TEXT, text: "" }] },
        { role: "user", content: [{ type: BlockType.TEXT, text: "Hello" }] },
      ];
      const result = toAiSdkMessages(messages);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe("Hello");
    });
  });

  // ---------------------------------------------------------------------------
  // toAiSdkMessages - ToolUseContent conversion
  // ---------------------------------------------------------------------------
  describe("ToolUseContent conversion", () => {
    test("converts tool use blocks to tool-call parts", () => {
      const messages: Array<Message> = [
        {
          role: "assistant",
          content: [
            {
              type: BlockType.TOOL_USE,
              toolUseId: "call-123",
              name: "echo",
              input: { text: "hello" },
            },
          ],
        },
      ];
      const result = toAiSdkMessages(messages);
      expect(result.messages).toHaveLength(1);
      const content = asContentArray(result.messages[0].content);
      expect(Array.isArray(content)).toBe(true);
      expect(content[0]).toEqual({
        type: "tool-call",
        toolCallId: "call-123",
        toolName: "echo",
        args: { text: "hello" },
      });
    });

    test("combines text and tool use in assistant message", () => {
      const messages: Array<Message> = [
        {
          role: "assistant",
          content: [
            { type: BlockType.TEXT, text: "Let me help" },
            {
              type: BlockType.TOOL_USE,
              toolUseId: "call-1",
              name: "search",
              input: { query: "test" },
            },
          ],
        },
      ];
      const result = toAiSdkMessages(messages);
      const content = asContentArray(result.messages[0].content);
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: "text", text: "Let me help" });
      expect(content[1]).toEqual({
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "search",
        args: { query: "test" },
      });
    });

    test("maps toolUseId to toolCallId", () => {
      const messages: Array<Message> = [
        {
          role: "assistant",
          content: [
            {
              type: BlockType.TOOL_USE,
              toolUseId: "unique-tool-id-456",
              name: "calc",
              input: { x: 1 },
            },
          ],
        },
      ];
      const result = toAiSdkMessages(messages);
      const content = result.messages[0].content as Array<{ toolCallId: string }>;
      expect(content[0].toolCallId).toBe("unique-tool-id-456");
    });

    test("maps name to toolName", () => {
      const messages: Array<Message> = [
        {
          role: "assistant",
          content: [
            {
              type: BlockType.TOOL_USE,
              toolUseId: "id",
              name: "my_custom_tool",
              input: {},
            },
          ],
        },
      ];
      const result = toAiSdkMessages(messages);
      const content = result.messages[0].content as Array<{ toolName: string }>;
      expect(content[0].toolName).toBe("my_custom_tool");
    });

    test("maps input to args", () => {
      const messages: Array<Message> = [
        {
          role: "assistant",
          content: [
            {
              type: BlockType.TOOL_USE,
              toolUseId: "id",
              name: "tool",
              input: { foo: "bar", nested: { a: 1 } },
            },
          ],
        },
      ];
      const result = toAiSdkMessages(messages);
      const content = result.messages[0].content as Array<{ args: Record<string, unknown> }>;
      expect(content[0].args).toEqual({ foo: "bar", nested: { a: 1 } });
    });
  });

  // ---------------------------------------------------------------------------
  // toAiSdkMessages - ToolResultContent conversion
  // ---------------------------------------------------------------------------
  describe("ToolResultContent conversion", () => {
    test("converts tool result to tool message", () => {
      const messages: Array<Message> = [
        {
          role: "user",
          content: [
            {
              type: BlockType.TOOL_RESULT,
              toolUseId: "call-123",
              content: "Tool output",
            },
          ],
        },
      ];
      const result = toAiSdkMessages(messages);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("tool");
      const content = asContentArray(result.messages[0].content);
      expect(content[0]).toEqual({
        type: "tool-result",
        toolCallId: "call-123",
        toolName: "",
        result: "Tool output",
        isError: false,
      });
    });

    test("maps status error to isError true", () => {
      const messages: Array<Message> = [
        {
          role: "user",
          content: [
            {
              type: BlockType.TOOL_RESULT,
              toolUseId: "call-123",
              content: "Error occurred",
              status: "error",
            },
          ],
        },
      ];
      const result = toAiSdkMessages(messages);
      const content = result.messages[0].content as Array<{ isError: boolean }>;
      expect(content[0].isError).toBe(true);
    });

    test("maps status success to isError false", () => {
      const messages: Array<Message> = [
        {
          role: "user",
          content: [
            {
              type: BlockType.TOOL_RESULT,
              toolUseId: "call-123",
              content: "Success",
              status: "success",
            },
          ],
        },
      ];
      const result = toAiSdkMessages(messages);
      const content = result.messages[0].content as Array<{ isError: boolean }>;
      expect(content[0].isError).toBe(false);
    });

    test("handles missing status (defaults to false)", () => {
      const messages: Array<Message> = [
        {
          role: "user",
          content: [
            {
              type: BlockType.TOOL_RESULT,
              toolUseId: "call-123",
              content: "Output",
            },
          ],
        },
      ];
      const result = toAiSdkMessages(messages);
      const content = result.messages[0].content as Array<{ isError: boolean }>;
      expect(content[0].isError).toBe(false);
    });

    test("converts multiple tool results", () => {
      const messages: Array<Message> = [
        {
          role: "user",
          content: [
            { type: BlockType.TOOL_RESULT, toolUseId: "call-1", content: "Result 1" },
            { type: BlockType.TOOL_RESULT, toolUseId: "call-2", content: "Result 2" },
          ],
        },
      ];
      const result = toAiSdkMessages(messages);
      const content = result.messages[0].content as Array<{ toolCallId: string }>;
      expect(content).toHaveLength(2);
      expect(content[0].toolCallId).toBe("call-1");
      expect(content[1].toolCallId).toBe("call-2");
    });
  });
});

// ---------------------------------------------------------------------------
// toAiSdkTools
// ---------------------------------------------------------------------------
describe("toAiSdkTools", () => {
  test("converts single tool", () => {
    const tools: Array<ToolDef> = [
      {
        name: "echo",
        description: "Echo text back",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    ];
    const result = toAiSdkTools(tools);
    expect(result).toEqual({
      echo: {
        description: "Echo text back",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    });
  });

  test("converts multiple tools", () => {
    const tools: Array<ToolDef> = [
      {
        name: "echo",
        description: "Echo tool",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "search",
        description: "Search tool",
        inputSchema: { type: "object", properties: { q: { type: "string" } } },
      },
    ];
    const result = toAiSdkTools(tools);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result.echo).toBeDefined();
    expect(result.search).toBeDefined();
  });

  test("preserves inputSchema as parameters", () => {
    const tools: Array<ToolDef> = [
      {
        name: "complex",
        description: "Complex tool",
        inputSchema: {
          type: "object",
          properties: {
            nested: {
              type: "object",
              properties: {
                foo: { type: "string" },
              },
            },
            array: { type: "array", items: { type: "number" } },
          },
          required: ["nested"],
        },
      },
    ];
    const result = toAiSdkTools(tools);
    expect(result.complex.parameters).toEqual(
      tools[0].inputSchema as typeof result.complex.parameters
    );
  });

  test("preserves description", () => {
    const tools: Array<ToolDef> = [
      {
        name: "tool",
        description: "This is a detailed description",
        inputSchema: { type: "object", properties: {} },
      },
    ];
    const result = toAiSdkTools(tools);
    expect(result.tool.description).toBe("This is a detailed description");
  });

  test("handles empty tools array", () => {
    const result = toAiSdkTools([]);
    expect(result).toEqual({});
  });

  test("handles tool with empty description", () => {
    const tools: Array<ToolDef> = [
      {
        name: "no_desc",
        description: "",
        inputSchema: { type: "object", properties: {} },
      },
    ];
    const result = toAiSdkTools(tools);
    expect(result.no_desc.description).toBe("");
  });
});

// ---------------------------------------------------------------------------
// fromAiSdkResponse
// ---------------------------------------------------------------------------
describe("fromAiSdkResponse", () => {
  // Helper to create mock GenerateTextResult
  function createMockResult(partial: {
    text?: string;
    toolCalls?: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>;
    finishReason?: string;
    usage?: LanguageModelUsage;
  }): GenerateTextResult<ToolSet, unknown> {
    return {
      text: partial.text ?? "",
      toolCalls: partial.toolCalls ?? [],
      finishReason: partial.finishReason as GenerateTextResult<ToolSet, unknown>["finishReason"],
      usage: partial.usage ?? usage(),
      // Required properties we don't use
      experimental_output: undefined,
      files: [],
      providerMetadata: undefined,
      reasoning: undefined,
      reasoningDetails: [],
      sources: [],
      warnings: undefined,
      steps: [],
      response: {} as GenerateTextResult<ToolSet, unknown>["response"],
      request: {} as GenerateTextResult<ToolSet, unknown>["request"],
      staticToolCalls: [],
      toolResults: [],
      finishMessage: undefined,
    } as unknown as GenerateTextResult<ToolSet, unknown>;
  }

  describe("text response", () => {
    test("converts text response to TextContent", () => {
      const result = createMockResult({ text: "Hello world" });
      const response = fromAiSdkResponse(result);
      expect(response.content).toHaveLength(1);
      expect(response.content[0]).toEqual({ type: BlockType.TEXT, text: "Hello world" });
    });

    test("handles empty text", () => {
      const result = createMockResult({ text: "" });
      const response = fromAiSdkResponse(result);
      expect(response.content).toHaveLength(0);
    });
  });

  describe("tool call response", () => {
    test("converts tool calls to ToolUseContent", () => {
      const result = createMockResult({
        toolCalls: [{ toolCallId: "call-1", toolName: "echo", args: { text: "hello" } }],
      });
      const response = fromAiSdkResponse(result);
      expect(response.content).toHaveLength(1);
      expect(response.content[0]).toEqual({
        type: BlockType.TOOL_USE,
        toolUseId: "call-1",
        name: "echo",
        input: { text: "hello" },
      });
    });

    test("converts multiple tool calls", () => {
      const result = createMockResult({
        toolCalls: [
          { toolCallId: "call-1", toolName: "tool1", args: {} },
          { toolCallId: "call-2", toolName: "tool2", args: { x: 1 } },
        ],
      });
      const response = fromAiSdkResponse(result);
      expect(response.content).toHaveLength(2);
    });

    test("combines text and tool calls", () => {
      const result = createMockResult({
        text: "Using tool",
        toolCalls: [{ toolCallId: "call-1", toolName: "search", args: {} }],
      });
      const response = fromAiSdkResponse(result);
      expect(response.content).toHaveLength(2);
      expect(response.content[0].type).toBe(BlockType.TEXT);
      expect(response.content[1].type).toBe(BlockType.TOOL_USE);
    });

    test("handles null args as empty object", () => {
      const result = createMockResult({
        toolCalls: [
          {
            toolCallId: "call-1",
            toolName: "tool",
            args: null as unknown as Record<string, unknown>,
          },
        ],
      });
      const response = fromAiSdkResponse(result);
      expect(response.content[0]).toEqual({
        type: BlockType.TOOL_USE,
        toolUseId: "call-1",
        name: "tool",
        input: {},
      });
    });
  });

  describe("usage mapping", () => {
    test("maps promptTokens to inputTokens", () => {
      const result = createMockResult({
        usage: usage({ completionTokens: 50, promptTokens: 100 }),
      });
      const response = fromAiSdkResponse(result);
      expect(response.usage.inputTokens).toBe(100);
    });

    test("maps completionTokens to outputTokens", () => {
      const result = createMockResult({
        usage: usage({ completionTokens: 50, promptTokens: 100 }),
      });
      const response = fromAiSdkResponse(result);
      expect(response.usage.outputTokens).toBe(50);
    });

    test("handles missing usage", () => {
      const result = createMockResult({ usage: undefined as unknown as LanguageModelUsage });
      const response = fromAiSdkResponse(result);
      expect(response.usage.inputTokens).toBe(0);
      expect(response.usage.outputTokens).toBe(0);
    });

    test("handles partial usage", () => {
      const result = createMockResult({
        usage: usage({ promptTokens: 50 }),
      });
      const response = fromAiSdkResponse(result);
      expect(response.usage.inputTokens).toBe(50);
      expect(response.usage.outputTokens).toBe(0);
    });
  });

  describe("stopReason mapping", () => {
    test("maps 'stop' to 'end_turn'", () => {
      const result = createMockResult({ finishReason: "stop" });
      const response = fromAiSdkResponse(result);
      expect(response.stopReason).toBe("end_turn");
    });

    test("maps 'tool-calls' to 'tool_use'", () => {
      const result = createMockResult({ finishReason: "tool-calls" });
      const response = fromAiSdkResponse(result);
      expect(response.stopReason).toBe("tool_use");
    });

    test("maps 'length' to 'max_tokens'", () => {
      const result = createMockResult({ finishReason: "length" });
      const response = fromAiSdkResponse(result);
      expect(response.stopReason).toBe("max_tokens");
    });

    test("handles undefined finishReason", () => {
      const result = createMockResult({ finishReason: undefined });
      const response = fromAiSdkResponse(result);
      expect(response.stopReason).toBe("end_turn");
    });

    test("handles unknown finishReason", () => {
      const result = createMockResult({ finishReason: "unknown" });
      const response = fromAiSdkResponse(result);
      // normalizeStopReason handles unknown values
      expect(response.stopReason).toBeDefined();
    });
  });
});
