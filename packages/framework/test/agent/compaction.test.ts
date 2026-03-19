import { describe, expect, it, mock } from "bun:test";
import {
  DefaultCompactionStrategy,
  SlidingWindowCompactionStrategy,
} from "../../src/agent/compaction";
import { ContextWindowManager } from "../../src/agent/context-window";
import type { CompactionStrategy } from "../../src/types/compaction";
import type { ContextWindowConfig } from "../../src/types/config";
import type { Message } from "../../src/types/llm";
import type { LLMProvider } from "../../src/types/providers";

// --- Helpers ---

function textMsg(role: "user" | "assistant", text: string): Message {
  return { content: [{ text, type: "text" }], role };
}

function systemMsg(text: string): Message {
  return { content: [{ text, type: "text" }], role: "system" };
}

function bigContent(chars: number): string {
  return "x".repeat(chars);
}

function mockProvider(summaryText: string): LLMProvider {
  return {
    chat: mock(async (_messages: Array<Message>) => ({
      content: [{ text: summaryText, type: "text" as const }],
      stopReason: "end_turn" as const,
      usage: { inputTokens: 100, outputTokens: 50 },
    })),
    chatStream: mock(async function* () {
      yield { content: summaryText, type: "text_delta" as const };
    }),
    contextWindowSize: 200_000,
  };
}

function failingProvider(): LLMProvider {
  return {
    chat: mock(async () => {
      throw new Error("LLM call failed");
    }),
    chatStream: mock(async function* () {
      yield undefined as never;
      throw new Error("LLM call failed");
    }),
    contextWindowSize: 200_000,
  };
}

// --- DefaultCompactionStrategy ---

describe("DefaultCompactionStrategy", () => {
  it("calls provider.chat() with summary prompt", async () => {
    const provider = mockProvider("This is a summary");
    const strategy = new DefaultCompactionStrategy();

    const messages: Array<Message> = [
      textMsg("user", "System prompt"),
      textMsg("assistant", "Hello there"),
      textMsg("user", "How are you?"),
      textMsg("assistant", "I'm good"),
      textMsg("user", "Tell me more"),
      textMsg("assistant", "Sure, here is more info"),
      textMsg("user", "Thanks"),
    ];

    await strategy.compact(messages, provider);

    expect(provider.chat).toHaveBeenCalledTimes(1);
    // Should call with a user message containing the compaction prompt
    const callArgs = (provider.chat as ReturnType<typeof mock>).mock.calls[0];
    const promptMessages = callArgs[0] as Array<Message>;
    expect(promptMessages.length).toBe(1);
    expect(promptMessages[0].role).toBe("user");
  });

  it("preserves system prompt (messages[0])", async () => {
    const provider = mockProvider("Summary of conversation");
    const strategy = new DefaultCompactionStrategy();

    const systemPrompt = systemMsg("You are a helpful assistant");
    const messages: Array<Message> = [
      systemPrompt,
      textMsg("assistant", "Hello"),
      textMsg("user", "Question 1"),
      textMsg("assistant", "Answer 1"),
      textMsg("user", "Question 2"),
      textMsg("assistant", "Answer 2"),
      textMsg("user", "Question 3"),
    ];

    const result = await strategy.compact(messages, provider);

    // First message must be the original system prompt
    expect(result[0]).toEqual(systemPrompt);
  });

  it("preserves recent messages (last 3-4 turns)", async () => {
    const provider = mockProvider("Summary of early conversation");
    const strategy = new DefaultCompactionStrategy();

    const messages: Array<Message> = [
      textMsg("user", "System prompt"),
      textMsg("assistant", "Hello"),
      textMsg("user", "Old question 1"),
      textMsg("assistant", "Old answer 1"),
      textMsg("user", "Recent question"),
      textMsg("assistant", "Recent answer"),
      textMsg("user", "Latest question"),
    ];

    const result = await strategy.compact(messages, provider);

    // Should preserve the last few messages
    const lastMsg = result.at(-1);
    expect(lastMsg).toBeDefined();
    expect(lastMsg!.content[0]).toEqual({ text: "Latest question", type: "text" });

    // Result should be shorter than original
    expect(result.length).toBeLessThan(messages.length);
  });

  it("injects summary with '## Conversation Summary' header", async () => {
    const summaryText = "Users discussed authentication and database design.";
    const provider = mockProvider(summaryText);
    const strategy = new DefaultCompactionStrategy();

    const messages: Array<Message> = [
      textMsg("user", "System prompt"),
      textMsg("assistant", "Hello"),
      textMsg("user", "Old question"),
      textMsg("assistant", "Old answer"),
      textMsg("user", "More questions"),
      textMsg("assistant", "More answers"),
      textMsg("user", "Latest question"),
    ];

    const result = await strategy.compact(messages, provider);

    // Should have a summary message with the header
    const summaryMsg = result.find((m) =>
      m.content.some(
        (c) => c.type === "text" && (c.text as string).startsWith("## Conversation Summary")
      )
    );
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg!.role).toBe("user");

    // Summary text should contain the LLM output
    const summaryContent = summaryMsg!.content.find(
      (c) => c.type === "text" && (c.text as string).includes(summaryText)
    );
    expect(summaryContent).toBeDefined();
  });

  it("handles short conversations (fewer messages than preservation window)", async () => {
    const provider = mockProvider("Short summary");
    const strategy = new DefaultCompactionStrategy();

    // Only 3 messages — too few to summarize meaningfully
    const messages: Array<Message> = [
      textMsg("user", "System prompt"),
      textMsg("assistant", "Hello"),
      textMsg("user", "Question"),
    ];

    const result = await strategy.compact(messages, provider);

    // Should return at least the original messages (nothing to compact)
    expect(result.length).toBeGreaterThanOrEqual(messages.length);
  });

  it("builds conversation text excluding system prompt for LLM call", async () => {
    const provider = mockProvider("A summary");
    const strategy = new DefaultCompactionStrategy();

    const messages: Array<Message> = [
      textMsg("user", "SYSTEM_PROMPT_TEXT"),
      textMsg("assistant", "Hello from assistant"),
      textMsg("user", "User question here"),
      textMsg("assistant", "Assistant reply here"),
      textMsg("user", "Another question"),
      textMsg("assistant", "Another reply"),
      textMsg("user", "Final question"),
    ];

    await strategy.compact(messages, provider);

    // The prompt sent to LLM should contain conversation text but not the system prompt
    const callArgs = (provider.chat as ReturnType<typeof mock>).mock.calls[0];
    const promptMessages = callArgs[0] as Array<Message>;
    const promptText = (promptMessages[0].content[0] as { text: string; type: "text" }).text;

    expect(promptText).not.toContain("SYSTEM_PROMPT_TEXT");
    expect(promptText).toContain("conversation");
  });

  it("calls provider.chat() without tools (second arg undefined)", async () => {
    const provider = mockProvider("A summary");
    const strategy = new DefaultCompactionStrategy();

    const messages: Array<Message> = [
      textMsg("user", "System"),
      textMsg("assistant", "Hello"),
      textMsg("user", "Q1"),
      textMsg("assistant", "A1"),
      textMsg("user", "Q2"),
      textMsg("assistant", "A2"),
      textMsg("user", "Q3"),
    ];

    await strategy.compact(messages, provider);

    const callArgs = (provider.chat as ReturnType<typeof mock>).mock.calls[0];
    // Second argument (tools) should be undefined
    expect(callArgs[1]).toBeUndefined();
  });
});

// --- ContextWindowManager.compact() ---

describe("ContextWindowManager.compact()", () => {
  const defaultConfig: ContextWindowConfig = {
    compactionThreshold: 0.85,
    maxContextTokens: 1000,
    pruneThreshold: 0.7,
  };

  it("orchestrates compaction and returns result with token savings", async () => {
    const mgr = new ContextWindowManager(defaultConfig);
    const provider = mockProvider("Short summary");

    const messages: Array<Message> = [
      textMsg("user", bigContent(400)),
      textMsg("assistant", bigContent(400)),
      textMsg("user", bigContent(400)),
      textMsg("assistant", bigContent(400)),
      textMsg("user", bigContent(400)),
      textMsg("assistant", bigContent(400)),
      textMsg("user", "final question"),
    ];

    const strategy = new DefaultCompactionStrategy();
    const result = await mgr.compact(messages, provider, strategy);

    expect(result.originalCount).toBe(messages.length);
    expect(result.compacted.length).toBeLessThan(messages.length);
    expect(result.tokensSaved).toBeGreaterThan(0);
  });

  it("falls back to hard-truncate on compaction failure", async () => {
    const mgr = new ContextWindowManager(defaultConfig);
    const provider = failingProvider();

    const messages: Array<Message> = [
      textMsg("user", "System prompt"),
      textMsg("assistant", "Hello"),
      textMsg("user", "Question 1"),
      textMsg("assistant", "Answer 1"),
      textMsg("user", "Question 2"),
      textMsg("assistant", "Answer 2"),
      textMsg("user", "Question 3"),
      textMsg("assistant", "Answer 3"),
      textMsg("user", "Question 4"),
      textMsg("assistant", "Answer 4"),
      textMsg("user", "Latest question"),
    ];

    const strategy = new DefaultCompactionStrategy();
    const result = await mgr.compact(messages, provider, strategy);

    // Should not throw, should return fallback
    expect(result.compacted.length).toBeGreaterThan(0);

    // Fallback: system + last 4 messages
    expect(result.compacted[0]).toEqual(messages[0]); // system prompt
    expect(result.compacted.length).toBe(5); // system + last 4
    expect(result.compacted.at(-1)).toEqual(messages.at(-1));
    expect(result.originalCount).toBe(messages.length);
  });

  it("uses custom strategy when provided", async () => {
    const mgr = new ContextWindowManager(defaultConfig);
    const provider = mockProvider("unused");

    const customResult: Array<Message> = [
      textMsg("user", "System"),
      textMsg("user", "Custom compacted result"),
    ];

    const customStrategy: CompactionStrategy = {
      compact: mock(async () => customResult),
    };

    const messages: Array<Message> = [
      textMsg("user", "System"),
      textMsg("assistant", "A"),
      textMsg("user", "B"),
      textMsg("assistant", "C"),
      textMsg("user", "D"),
    ];

    const result = await mgr.compact(messages, provider, customStrategy);

    expect(customStrategy.compact).toHaveBeenCalledTimes(1);
    expect(result.compacted).toEqual(customResult);
  });

  it("calculates tokensSaved correctly", async () => {
    const mgr = new ContextWindowManager(defaultConfig);
    const provider = mockProvider("Short");

    const messages: Array<Message> = [
      textMsg("user", bigContent(2000)),
      textMsg("assistant", bigContent(2000)),
      textMsg("user", bigContent(2000)),
      textMsg("assistant", bigContent(2000)),
      textMsg("user", bigContent(2000)),
      textMsg("assistant", bigContent(2000)),
      textMsg("user", bigContent(2000)),
      textMsg("assistant", bigContent(2000)),
      textMsg("user", "final"),
    ];

    const strategy = new DefaultCompactionStrategy();
    const result = await mgr.compact(messages, provider, strategy);

    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(typeof result.tokensSaved).toBe("number");
  });

  it("handles fallback tokensSaved calculation", async () => {
    const mgr = new ContextWindowManager(defaultConfig);
    const provider = failingProvider();

    const messages: Array<Message> = [
      textMsg("user", bigContent(800)),
      textMsg("assistant", bigContent(800)),
      textMsg("user", bigContent(800)),
      textMsg("assistant", bigContent(800)),
      textMsg("user", bigContent(800)),
      textMsg("assistant", bigContent(800)),
      textMsg("user", bigContent(800)),
      textMsg("assistant", bigContent(800)),
      textMsg("user", "latest"),
    ];

    const strategy = new DefaultCompactionStrategy();
    const result = await mgr.compact(messages, provider, strategy);

    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(result.originalCount).toBe(messages.length);
  });
});

function toolUseMsg(toolUseId: string, name: string): Message {
  return {
    content: [{ input: {}, name, toolUseId, type: "tool_use" }],
    role: "assistant",
  };
}

function toolResultMsg(toolUseId: string, content: string): Message {
  return {
    content: [{ content, toolUseId, type: "tool_result" }],
    role: "user",
  };
}

describe("SlidingWindowCompactionStrategy", () => {
  it("preserves system message + latest window messages", async () => {
    const strategy = new SlidingWindowCompactionStrategy({ windowSize: 6 });
    const provider = mockProvider("unused");

    const messages: Array<Message> = [
      textMsg("user", "System prompt"),
      textMsg("assistant", "Msg 1"),
      textMsg("user", "Msg 2"),
      textMsg("assistant", "Msg 3"),
      textMsg("user", "Msg 4"),
      textMsg("assistant", "Msg 5"),
      textMsg("user", "Msg 6"),
      textMsg("assistant", "Msg 7"),
      textMsg("user", "Msg 8"),
      textMsg("assistant", "Msg 9"),
      textMsg("user", "Msg 10"),
      textMsg("assistant", "Msg 11"),
      textMsg("user", "Msg 12"),
      textMsg("assistant", "Msg 13"),
      textMsg("user", "Msg 14"),
      textMsg("assistant", "Msg 15"),
      textMsg("user", "Msg 16"),
      textMsg("assistant", "Msg 17"),
      textMsg("user", "Msg 18"),
      textMsg("assistant", "Msg 19"),
      textMsg("user", "Msg 20"),
    ];

    const result = await strategy.compact(messages, provider);

    expect(result[0]).toEqual(messages[0]);
    expect(result.length).toBe(7);
    expect(result.at(-1)).toEqual(messages.at(-1));
  });

  it("returns all messages when under window size", async () => {
    const strategy = new SlidingWindowCompactionStrategy({ windowSize: 10 });
    const provider = mockProvider("unused");

    const messages: Array<Message> = [
      textMsg("user", "System"),
      textMsg("assistant", "A"),
      textMsg("user", "B"),
    ];

    const result = await strategy.compact(messages, provider);

    expect(result.length).toBe(3);
    expect(result).toEqual(messages);
  });

  it("preserves tool_use/tool_result pairs when both in window", async () => {
    const strategy = new SlidingWindowCompactionStrategy({ windowSize: 4 });
    const provider = mockProvider("unused");

    const messages: Array<Message> = [
      textMsg("user", "System"),
      textMsg("assistant", "Before tool"),
      toolUseMsg("tool-1", "echo"),
      toolResultMsg("tool-1", "result"),
      textMsg("assistant", "After tool"),
      textMsg("user", "Final"),
    ];

    const result = await strategy.compact(messages, provider);

    expect(result[0]).toEqual(messages[0]);
    expect(
      result.some((m) =>
        m.content.some(
          (c) => c.type === "tool_use" && (c as { toolUseId: string }).toolUseId === "tool-1"
        )
      )
    ).toBe(true);
    expect(
      result.some((m) =>
        m.content.some(
          (c) => c.type === "tool_result" && (c as { toolUseId: string }).toolUseId === "tool-1"
        )
      )
    ).toBe(true);
  });

  it("excludes broken tool pairs when result outside window", async () => {
    const strategy = new SlidingWindowCompactionStrategy({ windowSize: 3 });
    const provider = mockProvider("unused");

    const messages: Array<Message> = [
      textMsg("user", "System"),
      toolUseMsg("tool-1", "echo"),
      toolResultMsg("tool-1", "result"),
      textMsg("assistant", "Recent 1"),
      textMsg("user", "Recent 2"),
      textMsg("assistant", "Recent 3"),
    ];

    const result = await strategy.compact(messages, provider);

    expect(result[0]).toEqual(messages[0]);
    expect(
      result.some((m) => m.content.some((c) => c.type === "tool_use" || c.type === "tool_result"))
    ).toBe(false);
  });

  it("excludes broken tool pairs when use outside window", async () => {
    const strategy = new SlidingWindowCompactionStrategy({ windowSize: 3 });
    const provider = mockProvider("unused");

    const messages: Array<Message> = [
      textMsg("user", "System"),
      toolUseMsg("tool-1", "echo"),
      textMsg("assistant", "Recent 1"),
      textMsg("user", "Recent 2"),
      toolResultMsg("tool-1", "result"),
      textMsg("assistant", "Recent 3"),
    ];

    const result = await strategy.compact(messages, provider);

    expect(result[0]).toEqual(messages[0]);
    const hasToolContent = result.some((m) =>
      m.content.some((c) => c.type === "tool_use" || c.type === "tool_result")
    );
    expect(hasToolContent).toBe(false);
  });

  it("removes unmatched tool_use blocks that stay inside the candidate window", async () => {
    const strategy = new SlidingWindowCompactionStrategy({ windowSize: 3 });
    const provider = mockProvider("unused");

    const messages: Array<Message> = [
      textMsg("user", "System"),
      textMsg("assistant", "Before tool"),
      toolUseMsg("tool-1", "echo"),
      textMsg("assistant", "After tool"),
      textMsg("user", "Final"),
    ];

    const result = await strategy.compact(messages, provider);

    expect(result).toEqual([messages[0], messages[3], messages[4]]);
    expect(
      result.some((m) => m.content.some((c) => c.type === "tool_use" || c.type === "tool_result"))
    ).toBe(false);
  });

  it("handles multiple tool pairs correctly", async () => {
    const strategy = new SlidingWindowCompactionStrategy({ windowSize: 8 });
    const provider = mockProvider("unused");

    const messages: Array<Message> = [
      textMsg("user", "System"),
      textMsg("assistant", "Start"),
      toolUseMsg("tool-1", "scan"),
      toolResultMsg("tool-1", "scan result"),
      textMsg("assistant", "Mid"),
      toolUseMsg("tool-2", "analyze"),
      toolResultMsg("tool-2", "analysis"),
      textMsg("assistant", "Recent 1"),
      textMsg("user", "Recent 2"),
      textMsg("assistant", "Recent 3"),
    ];

    const result = await strategy.compact(messages, provider);

    expect(result[0]).toEqual(messages[0]);
    expect(
      result.some((m) =>
        m.content.some(
          (c) => c.type === "tool_use" && (c as { toolUseId: string }).toolUseId === "tool-1"
        )
      )
    ).toBe(true);
    expect(
      result.some((m) =>
        m.content.some(
          (c) => c.type === "tool_use" && (c as { toolUseId: string }).toolUseId === "tool-2"
        )
      )
    ).toBe(true);
  });

  it("does not call provider.chat (no LLM usage)", async () => {
    const provider = mockProvider("unused");
    const strategy = new SlidingWindowCompactionStrategy({ windowSize: 4 });

    const messages: Array<Message> = [
      textMsg("user", "System"),
      textMsg("assistant", "A"),
      textMsg("user", "B"),
      textMsg("assistant", "C"),
      textMsg("user", "D"),
      textMsg("assistant", "E"),
    ];

    await strategy.compact(messages, provider);

    expect(provider.chat).toHaveBeenCalledTimes(0);
  });

  it("returns empty array for empty messages", async () => {
    const strategy = new SlidingWindowCompactionStrategy({ windowSize: 5 });
    const provider = mockProvider("unused");

    const result = await strategy.compact([], provider);

    expect(result.length).toBe(0);
  });

  it("preserves only window messages when preserveSystemMessage is false", async () => {
    const strategy = new SlidingWindowCompactionStrategy({
      preserveSystemMessage: false,
      windowSize: 3,
    });
    const provider = mockProvider("unused");

    const messages: Array<Message> = [
      textMsg("user", "System"),
      textMsg("assistant", "A"),
      textMsg("user", "B"),
      textMsg("assistant", "C"),
      textMsg("user", "D"),
      textMsg("assistant", "E"),
    ];

    const result = await strategy.compact(messages, provider);

    expect(result.length).toBe(3);
    expect(result[0]).toEqual(messages[3]);
    expect(result[2]).toEqual(messages[5]);
  });

  it("handles tool pair at exact window boundary", async () => {
    const strategy = new SlidingWindowCompactionStrategy({ windowSize: 4 });
    const provider = mockProvider("unused");

    const messages: Array<Message> = [
      textMsg("user", "System"),
      textMsg("assistant", "Old 1"),
      textMsg("user", "Old 2"),
      textMsg("assistant", "Old 3"),
      toolUseMsg("tool-1", "scan"),
      toolResultMsg("tool-1", "result"),
      textMsg("assistant", "Recent"),
    ];

    const result = await strategy.compact(messages, provider);

    expect(result[0]).toEqual(messages[0]);
    expect(result.length).toBe(5);
    expect(
      result.some((m) =>
        m.content.some(
          (c) => c.type === "tool_use" && (c as { toolUseId: string }).toolUseId === "tool-1"
        )
      )
    ).toBe(true);
    expect(
      result.some((m) =>
        m.content.some(
          (c) => c.type === "tool_result" && (c as { toolUseId: string }).toolUseId === "tool-1"
        )
      )
    ).toBe(true);
  });
});
