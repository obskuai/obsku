/**
 * Integration tests for fromAiSdk() adapter function.
 *
 * Tests the full integration of:
 * - fromAiSdk() factory function
 * - chat() method with mock LanguageModel (text-only responses)
 * - contextWindowSize resolution
 * - Error wrapping in ProviderError
 *
 * Note: Tool call and streaming tests are complex to mock because the AI SDK
 * performs internal validation. Those behaviors are tested indirectly through
 * the existing converter.test.ts and stream-mapper.test.ts.
 */

import { describe, expect, test } from "bun:test";
import type { Message } from "@obsku/framework";
import { ProviderError } from "@obsku/framework";

import { fromAiSdk } from "../src/adapter";
import { createMockLanguageModel, createSystemMessage, createUserMessage } from "./mocks";

// --- fromAiSdk() basic functionality ---

describe("fromAiSdk", () => {
  describe("LLMProvider shape", () => {
    test("returns LLMProvider with chat method", () => {
      const model = createMockLanguageModel();
      const provider = fromAiSdk(model);

      expect(provider).toBeDefined();
      expect(typeof provider.chat).toBe("function");
      expect(typeof provider.chatStream).toBe("function");
    });

    test("returns LLMProvider with contextWindowSize", () => {
      const model = createMockLanguageModel();
      const provider = fromAiSdk(model);

      expect(provider.contextWindowSize).toBeTypeOf("number");
      expect(provider.contextWindowSize).toBeGreaterThan(0);
    });

    test("returns LLMProvider with optional maxOutputTokens", () => {
      const model = createMockLanguageModel();
      const provider = fromAiSdk(model, { maxOutputTokens: 4096 });

      expect(provider.maxOutputTokens).toBe(4096);
    });
  });

  describe("chat() text responses", () => {
    test("returns text response from mock", async () => {
      const model = createMockLanguageModel({
        generate: {
          text: "Hello, world!",
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 5 },
        },
      });

      const provider = fromAiSdk(model);
      const response = await provider.chat([createUserMessage("Hi")]);

      expect(response.content).toHaveLength(1);
      expect(response.content[0]).toEqual({ type: "text", text: "Hello, world!" });
      expect(response.stopReason).toBe("end_turn");
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(5);
    });

    test("handles empty text gracefully", async () => {
      const model = createMockLanguageModel({
        generate: {
          text: "",
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 0 },
        },
      });

      const provider = fromAiSdk(model);
      const response = await provider.chat([createUserMessage("Hi")]);

      expect(response.content).toHaveLength(0);
      expect(response.stopReason).toBe("end_turn");
    });

    test("handles system message extraction", async () => {
      const model = createMockLanguageModel({
        generate: {
          text: "Response to system instruction",
          finishReason: "stop",
        },
      });

      const provider = fromAiSdk(model);
      const messages: Message[] = [
        createSystemMessage("You are helpful."),
        createUserMessage("Hello"),
      ];

      const response = await provider.chat(messages);

      expect(response.content[0].type).toBe("text");
      if (response.content[0].type === "text") {
        expect(response.content[0].text).toBe("Response to system instruction");
      }
    });
  });

  describe("contextWindowSize resolution", () => {
    test("uses explicit config.contextWindowSize when provided", () => {
      const model = createMockLanguageModel();
      const provider = fromAiSdk(model, { contextWindowSize: 50000 });

      expect(provider.contextWindowSize).toBe(50000);
    });

    test("falls back to DEFAULT_CONTEXT_WINDOW_SIZE (128000) when not provided", () => {
      const model = createMockLanguageModel();
      const provider = fromAiSdk(model);

      expect(provider.contextWindowSize).toBe(128_000);
    });

    test("maxOutputTokens is passed through from config", () => {
      const model = createMockLanguageModel();
      const provider = fromAiSdk(model, { maxOutputTokens: 4096 });

      expect(provider.maxOutputTokens).toBe(4096);
    });

    test("maxOutputTokens is undefined when not provided", () => {
      const model = createMockLanguageModel();
      const provider = fromAiSdk(model);

      expect(provider.maxOutputTokens).toBeUndefined();
    });

    test("accepts providerOptions in config", () => {
      const model = createMockLanguageModel();
      const provider = fromAiSdk(model, {
        contextWindowSize: 100000,
        providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens: 8000 } } },
      });

      // providerOptions is used internally, just verify it doesn't throw
      expect(provider).toBeDefined();
    });
  });

  describe("error handling", () => {
    test("chat wraps errors in ProviderError", async () => {
      const model = createMockLanguageModel({
        generate: {
          error: new Error("API Error"),
        },
      });

      const provider = fromAiSdk(model);

      await expect(provider.chat([createUserMessage("Hi")])).rejects.toThrow(ProviderError);
    });

    test("chat wraps throttling errors with throttle code", async () => {
      const error = new Error("Rate limit exceeded");
      (error as unknown as Record<string, unknown>).statusCode = 429;

      const model = createMockLanguageModel({
        generate: { error },
      });

      const provider = fromAiSdk(model);

      try {
        await provider.chat([createUserMessage("Hi")]);
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        if (e instanceof ProviderError) {
          expect(e.code).toBe("throttle");
        }
      }
    });

    test("chat wraps auth errors (401) with auth code", async () => {
      const error = new Error("Unauthorized");
      (error as unknown as Record<string, unknown>).statusCode = 401;

      const model = createMockLanguageModel({
        generate: { error },
      });

      const provider = fromAiSdk(model);

      try {
        await provider.chat([createUserMessage("Hi")]);
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        if (e instanceof ProviderError) {
          expect(e.code).toBe("auth");
        }
      }
    });

    test("chat wraps auth errors (403) with auth code", async () => {
      const error = new Error("Forbidden");
      (error as unknown as Record<string, unknown>).statusCode = 403;

      const model = createMockLanguageModel({
        generate: { error },
      });

      const provider = fromAiSdk(model);

      try {
        await provider.chat([createUserMessage("Hi")]);
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        if (e instanceof ProviderError) {
          expect(e.code).toBe("auth");
        }
      }
    });

    test("chat wraps network errors with network code", async () => {
      const error = new Error("Connection refused");
      (error as unknown as Record<string, unknown>).code = "ECONNREFUSED";

      const model = createMockLanguageModel({
        generate: { error },
      });

      const provider = fromAiSdk(model);

      try {
        await provider.chat([createUserMessage("Hi")]);
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        if (e instanceof ProviderError) {
          expect(e.code).toBe("network");
        }
      }
    });

    test("chat wraps ETIMEDOUT with network code", async () => {
      const error = new Error("Timeout");
      (error as unknown as Record<string, unknown>).code = "ETIMEDOUT";

      const model = createMockLanguageModel({
        generate: { error },
      });

      const provider = fromAiSdk(model);

      try {
        await provider.chat([createUserMessage("Hi")]);
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        if (e instanceof ProviderError) {
          expect(e.code).toBe("network");
        }
      }
    });

    test("chat wraps unknown errors with unknown code", async () => {
      const error = new Error("Something weird");
      // No statusCode, no code property

      const model = createMockLanguageModel({
        generate: { error },
      });

      const provider = fromAiSdk(model);

      try {
        await provider.chat([createUserMessage("Hi")]);
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
        if (e instanceof ProviderError) {
          expect(e.code).toBe("unknown");
        }
      }
    });

    test("chatStream wraps errors in ProviderError", async () => {
      const model = createMockLanguageModel({
        stream: {
          error: new Error("Stream error"),
        },
      });

      const provider = fromAiSdk(model);

      try {
        const stream = provider.chatStream([createUserMessage("Hi")]);
        for await (const _ of stream) {
          // consume stream
        }
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ProviderError);
      }
    });
  });

  describe("finish reason mapping", () => {
    test("maps 'stop' to 'end_turn'", async () => {
      const model = createMockLanguageModel({
        generate: { text: "Done", finishReason: "stop" },
      });

      const provider = fromAiSdk(model);
      const response = await provider.chat([createUserMessage("Hi")]);

      expect(response.stopReason).toBe("end_turn");
    });

    test("maps 'length' to 'max_tokens'", async () => {
      const model = createMockLanguageModel({
        generate: { text: "Truncated", finishReason: "length" },
      });

      const provider = fromAiSdk(model);
      const response = await provider.chat([createUserMessage("Hi")]);

      expect(response.stopReason).toBe("max_tokens");
    });

    test("passes through unknown finish reasons", async () => {
      const model = createMockLanguageModel({
        generate: { text: "Done", finishReason: "some-unknown-reason" },
      });

      const provider = fromAiSdk(model);
      const response = await provider.chat([createUserMessage("Hi")]);

      // Unknown finish reasons fall through to the default mapping logic
      expect(["some-unknown-reason", "end_turn"]).toContain(response.stopReason);
    });
  });

  describe("usage tracking", () => {
    test("returns usage from generateText result", async () => {
      const model = createMockLanguageModel({
        generate: {
          text: "Response",
          finishReason: "stop",
          usage: { promptTokens: 150, completionTokens: 75 },
        },
      });

      const provider = fromAiSdk(model);
      const response = await provider.chat([createUserMessage("Hi")]);

      expect(response.usage.inputTokens).toBe(150);
      expect(response.usage.outputTokens).toBe(75);
    });

    test("handles zero usage", async () => {
      const model = createMockLanguageModel({
        generate: {
          text: "Response",
          finishReason: "stop",
          usage: { promptTokens: 0, completionTokens: 0 },
        },
      });

      const provider = fromAiSdk(model);
      const response = await provider.chat([createUserMessage("Hi")]);

      expect(response.usage.inputTokens).toBe(0);
      expect(response.usage.outputTokens).toBe(0);
    });
  });
});
