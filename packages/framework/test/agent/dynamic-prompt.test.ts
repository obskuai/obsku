import { describe, expect, test } from "bun:test";
import { agent } from "../../src/agent";
import type { LLMProvider, Message, PromptContext } from "../../src/types";

describe("Dynamic Prompts", () => {
  const mockProvider: LLMProvider = {
    chat: async (messages: Array<Message>) => {
      const firstMsg = messages[0];
      const text = firstMsg?.content[0]?.type === "text" ? firstMsg.content[0].text : "no message";
      return {
        content: [{ text, type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
    chatStream: async function* () {
      yield { content: "", type: "text_delta" };
    },
    contextWindowSize: 200_000,
  };

  test("static string prompt works unchanged (backward compat)", async () => {
    const a = agent({
      name: "static-prompt",
      prompt: "You are a static agent",
    });

    const result = await a.run("test input", mockProvider);
    expect(result).toBe("You are a static agent");
  });

  test("sync function prompt resolves correctly", async () => {
    const a = agent({
      name: "sync-prompt",
      prompt: (ctx: PromptContext) => `You are ${ctx.input}`,
    });

    const result = await a.run("dynamic", mockProvider);
    expect(result).toBe("You are dynamic");
  });

  test("async function prompt resolves correctly", async () => {
    const a = agent({
      name: "async-prompt",
      prompt: async (ctx: PromptContext) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return `Async: ${ctx.input}`;
      },
    });

    const result = await a.run("test", mockProvider);
    expect(result).toBe("Async: test");
  });

  test("prompt function receives correct context", async () => {
    let capturedCtx: PromptContext | undefined;

    const a = agent({
      name: "context-check",
      prompt: (ctx: PromptContext) => {
        capturedCtx = ctx;
        return "done";
      },
    });

    await a.run("user message", mockProvider, { sessionId: "session-123" });

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.input).toBe("user message");
    expect(capturedCtx!.messages).toEqual([]);
    expect(capturedCtx!.sessionId).toBe("session-123");
  });

  test("prompt function error propagates as agent error", async () => {
    const a = agent({
      name: "error-prompt",
      prompt: () => {
        throw new Error("Prompt generation failed");
      },
    });

    return expect(a.run("test", mockProvider)).rejects.toThrow("Prompt generation failed");
  });

  test("prompt function returning empty string is valid", async () => {
    const a = agent({
      name: "empty-prompt",
      prompt: () => "",
    });

    const result = await a.run("test", mockProvider);
    expect(result).toBe("");
  });

  test("async prompt function error propagates correctly", async () => {
    const a = agent({
      name: "async-error-prompt",
      prompt: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error("Async prompt failed");
      },
    });

    return expect(a.run("test", mockProvider)).rejects.toThrow("Async prompt failed");
  });
});
