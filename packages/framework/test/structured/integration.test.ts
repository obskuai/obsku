import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { structuredAgent } from "../../src/structured";
import type { ChatOptions, LLMProvider, LLMResponse, Message, ToolDef } from "../../src/types";
import {
  clearRecordedCalls,
  createMockProviderWithStructuredOutput,
  getRecordedCalls,
  mockLLMProvider,
  recordedCalls,
} from "../utils/mock-llm-provider";

describe("structured output integration", () => {
  beforeEach(() => {
    clearRecordedCalls();
  });

  const personSchema = z.object({
    age: z.number(),
    email: z.string().email(),
    name: z.string(),
  });

  describe("native path - provider receives responseFormat", () => {
    test("mock provider correctly receives options with responseFormat", async () => {
      const provider = mockLLMProvider();
      const agent = structuredAgent({
        name: "test",
        output: personSchema,
        prompt: "Generate a person profile",
      });

      // Override chat to return valid JSON
      const mockProvider: LLMProvider = {
        ...provider,
        async chat(
          messages: Array<Message>,
          tools?: Array<ToolDef>,
          options?: ChatOptions
        ): Promise<LLMResponse> {
          recordedCalls.push({ messages, options, tools });
          return {
            content: [
              { text: '{"name": "Alice", "age": 30, "email": "alice@example.com"}', type: "text" },
            ],
            stopReason: "end_turn",
            usage: { inputTokens: 50, outputTokens: 30 },
          };
        },
      };

      const result = await agent.run("Generate a profile", mockProvider);

      // Verify the result is typed correctly
      expect(result).toEqual({
        age: 30,
        email: "alice@example.com",
        name: "Alice",
      });

      // Verify options were passed with responseFormat
      const calls = getRecordedCalls();
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0].options).toBeDefined();
      expect(calls[0].options?.responseFormat).toBeDefined();
      expect(calls[0].options?.responseFormat?.type).toBe("json_schema");
      expect(calls[0].options?.responseFormat?.jsonSchema.name).toBe("test");
    });

    test("structuredAgent → agent loop → provider.chat → validated output", async () => {
      const provider = createMockProviderWithStructuredOutput({
        response: {
          age: 25,
          email: "bob@example.com",
          name: "Bob",
        },
      });

      const agent = structuredAgent({
        name: "personGenerator",
        output: personSchema,
        prompt: "Generate a person profile",
      });

      const result = await agent.run("Generate a profile for Bob", provider);

      // Verify typed output
      expect(result.name).toBe("Bob");
      expect(result.age).toBe(25);
      expect(result.email).toBe("bob@example.com");

      // Verify responseFormat was passed
      const calls = getRecordedCalls();
      expect(calls.length).toBe(1);
      expect(calls[0].options?.responseFormat).toBeDefined();
    });

    test("provider receives correct JSON schema in responseFormat", async () => {
      const provider = mockLLMProvider();
      let capturedResponseFormat: ChatOptions["responseFormat"];

      const mockProvider: LLMProvider = {
        ...provider,
        async chat(
          messages: Array<Message>,
          tools?: Array<ToolDef>,
          options?: ChatOptions
        ): Promise<LLMResponse> {
          capturedResponseFormat = options?.responseFormat;
          return {
            content: [
              { text: '{"name": "Test", "age": 20, "email": "test@test.com"}', type: "text" },
            ],
            stopReason: "end_turn",
            usage: { inputTokens: 50, outputTokens: 30 },
          };
        },
      };

      const agent = structuredAgent({
        name: "schemaTest",
        output: personSchema,
        prompt: "Generate test data",
      });

      await agent.run("Test", mockProvider);

      // Verify the schema was correctly converted from Zod
      expect(capturedResponseFormat).toBeDefined();
      expect(capturedResponseFormat?.type).toBe("json_schema");
      expect(capturedResponseFormat?.jsonSchema.name).toBe("schemaTest");

      // Verify the schema structure
      const schema = capturedResponseFormat?.jsonSchema.schema as Record<string, unknown>;
      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();
      expect((schema.properties as Record<string, unknown>).name).toBeDefined();
      expect((schema.properties as Record<string, unknown>).age).toBeDefined();
      expect((schema.properties as Record<string, unknown>).email).toBeDefined();
    });
  });

  describe("validation retry path", () => {
    test("retries on validation failure with error context in prompt", async () => {
      let callCount = 0;
      const provider = mockLLMProvider();

      const mockProvider: LLMProvider = {
        ...provider,
        async chat(
          messages: Array<Message>,
          tools?: Array<ToolDef>,
          options?: ChatOptions
        ): Promise<LLMResponse> {
          callCount++;
          recordedCalls.push({ messages, options, tools });

          if (callCount === 1) {
            return {
              content: [{ text: '{"name": "Incomplete"}', type: "text" }],
              stopReason: "end_turn",
              usage: { inputTokens: 50, outputTokens: 20 },
            };
          }

          return {
            content: [
              {
                text: '{"name": "Complete", "age": 40, "email": "complete@example.com"}',
                type: "text",
              },
            ],
            stopReason: "end_turn",
            usage: { inputTokens: 50, outputTokens: 30 },
          };
        },
      };

      const agent = structuredAgent({
        maxRetries: 2,
        name: "retryTest",
        output: personSchema,
        prompt: "Generate a person",
      });

      const result = await agent.run("Generate", mockProvider);

      expect(result.name).toBe("Complete");
      expect(callCount).toBe(2);

      const calls = getRecordedCalls();
      const retryCall = calls[1];
      const userMessage = retryCall.messages.find((m) => m.role === "user");
      const allText =
        userMessage?.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n") || "";
      expect(allText).toContain("failed validation");
    });

    test("multiple validation retries before success", async () => {
      let callCount = 0;
      const provider = mockLLMProvider();

      const mockProvider: LLMProvider = {
        ...provider,
        async chat(
          messages: Array<Message>,
          tools?: Array<ToolDef>,
          options?: ChatOptions
        ): Promise<LLMResponse> {
          callCount++;
          recordedCalls.push({ messages, options, tools });

          if (callCount < 3) {
            return {
              content: [{ text: '{"name": "Retry' + callCount + '"}', type: "text" }],
              stopReason: "end_turn",
              usage: { inputTokens: 50, outputTokens: 20 },
            };
          }

          return {
            content: [
              {
                text: '{"name": "Success", "age": 30, "email": "success@example.com"}',
                type: "text",
              },
            ],
            stopReason: "end_turn",
            usage: { inputTokens: 50, outputTokens: 30 },
          };
        },
      };

      const agent = structuredAgent({
        maxRetries: 3,
        name: "multiRetry",
        output: personSchema,
        prompt: "Generate a person",
      });

      const result = await agent.run("Generate", mockProvider);

      expect(result.name).toBe("Success");
      expect(callCount).toBe(3);
    });

    test("throws after max retries exceeded", async () => {
      const provider = mockLLMProvider();

      const mockProvider: LLMProvider = {
        ...provider,
        async chat(
          messages: Array<Message>,
          tools?: Array<ToolDef>,
          options?: ChatOptions
        ): Promise<LLMResponse> {
          recordedCalls.push({ messages, options, tools });
          return {
            content: [{ text: '{"name": "AlwaysInvalid"}', type: "text" }],
            stopReason: "end_turn",
            usage: { inputTokens: 50, outputTokens: 20 },
          };
        },
      };

      const agent = structuredAgent({
        maxRetries: 2,
        name: "failTest",
        output: personSchema,
        prompt: "Generate a person",
      });

      await expect(agent.run("Generate", mockProvider)).rejects.toThrow();

      const calls = getRecordedCalls();
      expect(calls.length).toBe(3);
    });
  });

  describe("end-to-end validation scenarios", () => {
    test("complex nested schema validation", async () => {
      const addressSchema = z.object({
        city: z.string(),
        street: z.string(),
        zipCode: z.string(),
      });

      const companySchema = z.object({
        address: addressSchema,
        employees: z.number(),
        name: z.string(),
      });

      const provider = createMockProviderWithStructuredOutput({
        response: {
          address: {
            city: "San Francisco",
            street: "123 Tech St",
            zipCode: "94105",
          },
          employees: 100,
          name: "TechCorp",
        },
      });

      const agent = structuredAgent({
        name: "companyGenerator",
        output: companySchema,
        prompt: "Generate a company profile",
      });

      const result = await agent.run("Generate a company", provider);

      expect(result.name).toBe("TechCorp");
      expect(result.address.city).toBe("San Francisco");
      expect(result.employees).toBe(100);

      // Verify responseFormat was passed
      const calls = getRecordedCalls();
      expect(calls[0].options?.responseFormat?.jsonSchema.schema).toBeDefined();
    });

    test("validation failure with specific error message", async () => {
      let attemptCount = 0;
      const provider = mockLLMProvider();

      const mockProvider: LLMProvider = {
        ...provider,
        async chat(
          messages: Array<Message>,
          tools?: Array<ToolDef>,
          options?: ChatOptions
        ): Promise<LLMResponse> {
          attemptCount++;
          recordedCalls.push({ messages, options, tools });

          if (attemptCount === 1) {
            // Return invalid JSON (missing required field)
            return {
              content: [{ text: '{"name": "Invalid"}', type: "text" }],
              stopReason: "end_turn",
              usage: { inputTokens: 50, outputTokens: 20 },
            };
          }

          // Return valid JSON on retry
          return {
            content: [
              { text: '{"name": "Valid", "age": 25, "email": "valid@test.com"}', type: "text" },
            ],
            stopReason: "end_turn",
            usage: { inputTokens: 50, outputTokens: 30 },
          };
        },
      };

      const agent = structuredAgent({
        maxRetries: 2,
        name: "errorTest",
        output: personSchema,
        prompt: "Generate a person",
      });

      const result = await agent.run("Generate", mockProvider);

      expect(result.name).toBe("Valid");
      expect(attemptCount).toBe(2);

      const calls = getRecordedCalls();
      const retryCall = calls[1];
      const userMessage = retryCall.messages.find((m) => m.role === "user");
      const allText =
        userMessage?.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n") || "";
      expect(allText).toContain("failed validation");
    });

    test("responseFormat is passed through agent.run options", async () => {
      let receivedOptions: ChatOptions | undefined;
      const provider = mockLLMProvider();

      const mockProvider: LLMProvider = {
        ...provider,
        async chat(
          messages: Array<Message>,
          tools?: Array<ToolDef>,
          options?: ChatOptions
        ): Promise<LLMResponse> {
          receivedOptions = options;
          recordedCalls.push({ messages, options, tools });
          return {
            content: [
              { text: '{"name": "Test", "age": 20, "email": "test@test.com"}', type: "text" },
            ],
            stopReason: "end_turn",
            usage: { inputTokens: 50, outputTokens: 30 },
          };
        },
      };

      const agent = structuredAgent({
        name: "optionsTest",
        output: personSchema,
        prompt: "Generate test data",
      });

      await agent.run("Test", mockProvider);

      expect(receivedOptions).toBeDefined();
      expect(receivedOptions?.responseFormat).toBeDefined();
      expect(receivedOptions?.responseFormat?.type).toBe("json_schema");
    });
  });
});
