import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { ToolDef } from "../../src/types";
import { defaultConfig, makeEmit, makePlugin } from "../utils/helpers";
import { runReactLoop } from "../utils/loop-helpers";

function makeFixedUsageProvider(fixedUsage: { inputTokens: number; outputTokens: number }) {
  let callCount = 0;
  return {
    async chat(messages: Array<unknown>, tools?: Array<ToolDef>) {
      callCount++;
      const hasToolResult = messages
        .at(-1)
        ?.content?.some((c: { type: string }) => c.type === "tool_result");

      if (hasToolResult || (tools && tools.length > 0)) {
        return {
          content: [
            {
              input: {},
              name: tools![0].name,
              toolUseId: `tool_${callCount}`,
              type: "tool_use",
            },
          ],
          stopReason: "tool_use",
          usage: fixedUsage,
        };
      }

      return {
        content: [{ text: `Response ${callCount}`, type: "text" }],
        stopReason: "end_turn",
        usage: fixedUsage,
      };
    },
    async chatStream() {
      throw new Error("Not implemented");
    },
    contextWindowSize: 200_000,
  };
}

describe("usage accumulation", () => {
  test("accumulates usage across multiple LLM calls", async () => {
    const events: Array<unknown> = [];
    const emit = makeEmit(events as Array<never>);
    const provider = makeFixedUsageProvider({ inputTokens: 100, outputTokens: 50 });
    const echoPlugin = makePlugin("echo", "echo result");
    const echoToolDef: ToolDef = {
      description: "echo",
      inputSchema: { properties: {}, required: [], type: "object" },
      name: "echo",
    };

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "test", type: "text" }], role: "user" }],
        [echoToolDef],
        new Map([["echo", echoPlugin]]),
        provider,
        { ...defaultConfig, maxIterations: 3 },
        new Set(),
        undefined,
        emit
      )
    );

    const completeEvent = events.find((e) => (e as { type: string }).type === "agent.complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent).toHaveProperty("usage");

    const usage = (
      completeEvent as {
        usage: { llmCalls: number; totalInputTokens: number; totalOutputTokens: number };
      }
    ).usage;
    expect(usage.totalInputTokens).toBe(300);
    expect(usage.totalOutputTokens).toBe(150);
    expect(usage.llmCalls).toBe(3);
  });

  test("handles single iteration correctly", async () => {
    const events: Array<unknown> = [];
    const emit = makeEmit(events as Array<never>);
    const provider = makeFixedUsageProvider({ inputTokens: 50, outputTokens: 25 });

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "test", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        emit
      )
    );

    const completeEvent = events.find((e) => (e as { type: string }).type === "agent.complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent).toHaveProperty("usage");

    const usage = (
      completeEvent as {
        usage: { llmCalls: number; totalInputTokens: number; totalOutputTokens: number };
      }
    ).usage;
    expect(usage.totalInputTokens).toBe(50);
    expect(usage.totalOutputTokens).toBe(25);
    expect(usage.llmCalls).toBe(1);
  });

  test("accumulates usage with varying per-call usage", async () => {
    const events: Array<unknown> = [];
    const emit = makeEmit(events as Array<never>);
    let callCount = 0;
    const varyingUsageProvider = {
      async chat(messages: Array<unknown>, tools?: Array<ToolDef>) {
        callCount++;
        const usagePerCall = [
          { inputTokens: 100, outputTokens: 50 },
          { inputTokens: 150, outputTokens: 75 },
          { inputTokens: 200, outputTokens: 100 },
        ];
        const usage = usagePerCall[(callCount - 1) % usagePerCall.length];

        if (tools && tools.length > 0 && callCount < 3) {
          return {
            content: [
              {
                input: {},
                name: tools[0].name,
                toolUseId: `tool_${callCount}`,
                type: "tool_use",
              },
            ],
            stopReason: "tool_use",
            usage,
          };
        }

        return {
          content: [{ text: `Response ${callCount}`, type: "text" }],
          stopReason: "end_turn",
          usage,
        };
      },
      async chatStream() {
        throw new Error("Not implemented");
      },
      contextWindowSize: 200_000,
    };

    const echoPlugin = makePlugin("echo", "echo result");
    const echoToolDef: ToolDef = {
      description: "echo",
      inputSchema: { properties: {}, required: [], type: "object" },
      name: "echo",
    };

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "test", type: "text" }], role: "user" }],
        [echoToolDef],
        new Map([["echo", echoPlugin]]),
        varyingUsageProvider,
        { ...defaultConfig, maxIterations: 3 },
        new Set(),
        undefined,
        emit
      )
    );

    const completeEvent = events.find((e) => (e as { type: string }).type === "agent.complete");
    const usage = (
      completeEvent as {
        usage: { llmCalls: number; totalInputTokens: number; totalOutputTokens: number };
      }
    ).usage;

    expect(usage.totalInputTokens).toBe(450);
    expect(usage.totalOutputTokens).toBe(225);
    expect(usage.llmCalls).toBe(3);
  });
});
