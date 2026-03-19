// TDD Test: ChatOptions Type + LLMProvider Interface
// RED Phase: These tests verify that ChatOptions and ResponseFormat types exist
// They will FAIL initially until we add the type definitions

import { describe, expect, it } from "bun:test";
import type {
  ChatOptions,
  LLMProvider,
  Message,
  ResponseFormat,
  ToolDef,
} from "../../src/index";

describe("ChatOptions Types", () => {
  describe("ResponseFormat interface", () => {
    it("should have type: 'json_schema'", () => {
      const format: ResponseFormat = {
        jsonSchema: {
          schema: { type: "object" },
        },
        type: "json_schema",
      };

      expect(format.type).toBe("json_schema");
    });

    it("should have jsonSchema with schema field", () => {
      const format: ResponseFormat = {
        jsonSchema: {
          schema: {
            properties: {
              name: { type: "string" },
            },
            type: "object",
          },
        },
        type: "json_schema",
      };

      expect(format.jsonSchema.schema).toBeDefined();
    });

    it("should have optional jsonSchema.name field", () => {
      const formatWithName: ResponseFormat = {
        jsonSchema: {
          name: "TestSchema",
          schema: { type: "object" },
        },
        type: "json_schema",
      };

      const formatWithoutName: ResponseFormat = {
        jsonSchema: {
          schema: { type: "object" },
        },
        type: "json_schema",
      };

      expect(formatWithName.jsonSchema.name).toBe("TestSchema");
      expect(formatWithoutName.jsonSchema.name).toBeUndefined();
    });

    it("should have optional jsonSchema.description field", () => {
      const formatWithDesc: ResponseFormat = {
        jsonSchema: {
          description: "A test schema",
          schema: { type: "object" },
        },
        type: "json_schema",
      };

      const formatWithoutDesc: ResponseFormat = {
        jsonSchema: {
          schema: { type: "object" },
        },
        type: "json_schema",
      };

      expect(formatWithDesc.jsonSchema.description).toBe("A test schema");
      expect(formatWithoutDesc.jsonSchema.description).toBeUndefined();
    });
  });

  describe("ChatOptions interface", () => {
    it("should exist with optional responseFormat field", () => {
      const options: ChatOptions = {
        responseFormat: {
          jsonSchema: {
            schema: { type: "object" },
          },
          type: "json_schema",
        },
      };

      expect(options.responseFormat).toBeDefined();
      expect(options.responseFormat?.type).toBe("json_schema");
    });

    it("should work without responseFormat (empty options)", () => {
      const options: ChatOptions = {};

      expect(options.responseFormat).toBeUndefined();
    });
  });
});

describe("LLMProvider.chat() signature", () => {
  it("should accept ChatOptions as third parameter", () => {
    // Type-level test - verify the signature accepts options
    const mockProvider: LLMProvider = {
      chat: async (_messages: Array<Message>, _tools?: Array<ToolDef>, options?: ChatOptions) => {
        // Verify options type is correct
        // Verify options type is correct (using type annotation only)
        const _opts: ChatOptions | undefined = options;
        return {
          content: [{ text: "test", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      chatStream: async function* (
        _messages: Array<Message>,
        _tools?: Array<ToolDef>
      ): AsyncIterable<{
        readonly content: string;
        readonly type: "text_delta";
      }> {
        yield { content: "test", type: "text_delta" };
      },
      contextWindowSize: 100_000,
    };

    expect(mockProvider.chat).toBeDefined();
  });

  it("should work with only messages (backward compat)", () => {
    const mockProvider: LLMProvider = {
      chat: async (_messages: Array<Message>) => {
        return {
          content: [{ text: "test", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      chatStream: async function* (
        _messages: Array<Message>,
        _tools?: Array<ToolDef>
      ): AsyncIterable<{
        readonly content: string;
        readonly type: "text_delta";
      }> {
        yield { content: "test", type: "text_delta" };
      },
      contextWindowSize: 100_000,
    };

    expect(mockProvider.chat).toBeDefined();
  });

  it("should work with messages and tools (backward compat)", () => {
    const mockProvider: LLMProvider = {
      chat: async (_messages: Array<Message>, _tools?: Array<ToolDef>) => {
        return {
          content: [{ text: "test", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      chatStream: async function* (
        _messages: Array<Message>,
        _tools?: Array<ToolDef>
      ): AsyncIterable<{
        readonly content: string;
        readonly type: "text_delta";
      }> {
        yield { content: "test", type: "text_delta" };
      },
      contextWindowSize: 100_000,
    };

    expect(mockProvider.chat).toBeDefined();
  });
});
