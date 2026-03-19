import {
  agent,
  type CanonicalAgentEvent,
  type InternalPlugin,
  wrapProvider,
} from "@obsku/framework";
import { Effect } from "effect";
import { type BenchmarkContext } from "../runner";
import { assertMetric, isCanonicalEvent, MetricEvaluation } from "../scoring/shared";
import type { Scenario, ScoringCriteria } from "../types";

const SCORING_CRITERIA: ScoringCriteria[] = [
  {
    name: "before_hook_fired",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 0.25,
  },
  { name: "after_hook_fired", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  { name: "hook_count_match", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  {
    name: "dynamic_prompt_used",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 0.25,
  },
];

const INPUT = "Call echo with text 'test-value'";

const echoTool: InternalPlugin = {
  description: "Echo deterministic text input.",
  execute: (input) =>
    Effect.succeed({
      echoed: typeof input.text === "string" ? input.text : String(input.text ?? ""),
    }),
  name: "echo",
  params: {
    text: { required: true, type: "string" },
  },
};

function evaluateBeforeHookFired(beforeCalls: Array<{ messages: unknown[] }>): MetricEvaluation {
  const validEntries = beforeCalls.every((call) => Array.isArray(call.messages));

  return {
    failureClass: "framework",
    note: `beforeCalls=${beforeCalls.length}, validEntries=${validEntries}`,
    score: beforeCalls.length >= 1 ? 1 : 0,
  };
}

function evaluateAfterHookFired(afterCalls: Array<{ response: unknown }>): MetricEvaluation {
  return {
    failureClass: "framework",
    note: `afterCalls=${afterCalls.length}`,
    score: afterCalls.length >= 1 ? 1 : 0,
  };
}

function evaluateHookCountMatch(
  beforeCalls: Array<{ messages: unknown[] }>,
  afterCalls: Array<{ response: unknown }>
): MetricEvaluation {
  return {
    failureClass: "framework",
    note: `beforeCalls=${beforeCalls.length}, afterCalls=${afterCalls.length}`,
    score: beforeCalls.length === afterCalls.length ? 1 : 0,
  };
}

function evaluateDynamicPromptUsed(output: string): MetricEvaluation {
  const echoed = /test-value/i.test(output);

  return {
    failureClass: "provider",
    note: `echoed=${echoed}, output=${JSON.stringify(output)}`,
    score: echoed ? 1 : 0,
  };
}

export const providerHooksScenario: Scenario<BenchmarkContext> = {
  description: "Provider wrapping benchmark with observational before/after chat hooks.",
  name: "provider-hooks",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(ctx) {
    const beforeCalls: Array<{ messages: unknown[] }> = [];
    const afterCalls: Array<{ response: unknown }> = [];

    const baseProvider = await ctx.createBedrockProvider({ maxOutputTokens: 256 });
    const provider = wrapProvider(baseProvider, {
      afterChat: async (response) => {
        afterCalls.push({ response });
      },
      beforeChat: async (messages) => {
        beforeCalls.push({ messages });
      },
    });

    const subject = agent({
      name: "provider-hooks-benchmark",
      prompt: (promptCtx) =>
        `You are a concise assistant. Session: ${promptCtx.sessionId ?? "unknown"}. Message count: ${promptCtx.messages.length}. Always execute required tools before answering and reply with the echoed value.`,
      streaming: true,
      tools: [echoTool],
    });

    const { events, result: output } = await ctx.collectAgentEvents(subject, (sessionId) =>
      subject.run(INPUT, provider, { sessionId })
    );

    if (!events.length || !events.every(isCanonicalEvent)) {
      throw new Error("provider-hooks emitted no canonical events");
    }

    const sessionEnds = events.filter(
      (event): event is Extract<CanonicalAgentEvent, { type: "session.end" }> =>
        event.type === "session.end"
    );

    if (sessionEnds.length !== 1 || sessionEnds[0]?.status !== "complete") {
      throw new Error(`session.end status mismatch: ${sessionEnds[0]?.status ?? "missing"}`);
    }

    const evaluations = [
      evaluateBeforeHookFired(beforeCalls),
      evaluateAfterHookFired(afterCalls),
      evaluateHookCountMatch(beforeCalls, afterCalls),
      evaluateDynamicPromptUsed(output),
    ];

    for (const [index, evaluation] of evaluations.entries()) {
      assertMetric(SCORING_CRITERIA[index]!, evaluation);
    }
  },
};
