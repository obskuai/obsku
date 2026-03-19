import {
  type AgentEvent,
  agent,
  type CanonicalAgentEvent,
  type LLMProvider,
} from "@obsku/framework";
import { buildUsage } from "../artifacts/writers";
import { type BenchmarkContext, providerInstability } from "../runner";
import { ratio } from "../scoring/scorer";
import { assertMetric, isCanonicalEvent, MetricEvaluation } from "../scoring/shared";
import type { Scenario, ScoringCriteria } from "../types";

const MAX_CONTEXT_TOKENS = 2_000;
const COMPACTION_THRESHOLD = 0.8;
const MAX_OUTPUT_TOKENS = 256;
const INPUT_TOKEN_BUDGET = 16_000;
const OUTPUT_TOKEN_BUDGET = 2_048;
const SOFT_SCENARIO_BUDGET_USD = 0.5;

const SCORING_CRITERIA: ScoringCriteria[] = [
  { name: "compaction_event_presence", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  { name: "token_savings", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  { name: "context_preservation", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  { name: "usage_bounds", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
];

type UsageAccumulator = {
  callCount: number;
  calls: Array<{
    inputTokens: number;
    messageCount: number;
    outputTokens: number;
    toolCount: number;
  }>;
  inputTokens: number;
  outputTokens: number;
};


function denseNotes(label: string, repeat = 28): string {
  return Array.from(
    { length: repeat },
    (_, index) =>
      `${label} note ${index + 1}: retain bounded-compaction context, preserve planning continuity, and keep the conversation intentionally verbose for token pressure.`
  ).join(" ");
}

function buildHistory() {
  return [
    {
      content: `Reference facts for later recall: the project codename is ORBIT-LANTERN and the approval token is PINEAPPLE-47. ${denseNotes("fact-seed-a")}`,
      role: "user" as const,
    },
    {
      content: `Acknowledged. I will remember ORBIT-LANTERN and PINEAPPLE-47 for later. ${denseNotes("fact-seed-b")}`,
      role: "assistant" as const,
    },
    {
      content: `Also keep in mind that these facts matter even after context cleanup. ${denseNotes("fact-seed-c")}`,
      role: "user" as const,
    },
    {
      content: `Understood. I should preserve the codename ORBIT-LANTERN and token PINEAPPLE-47 if the conversation is summarized. ${denseNotes("fact-seed-d")}`,
      role: "assistant" as const,
    },
    {
      content: `Now switch topics and discuss rollout sequencing only. ${denseNotes("recent-buffer-a")}`,
      role: "user" as const,
    },
    {
      content: `Rollout sequencing noted. ${denseNotes("recent-buffer-b")}`,
      role: "assistant" as const,
    },
    {
      content: `Keep talking about release logistics and not the original facts. ${denseNotes("recent-buffer-c")}`,
      role: "user" as const,
    },
    {
      content: `Release logistics captured. ${denseNotes("recent-buffer-d")}`,
      role: "assistant" as const,
    },
  ];
}

function createUsageTrackingProvider(
  provider: LLMProvider,
  accumulator: UsageAccumulator
): LLMProvider {
  return {
    async chat(messages, tools, options) {
      const response = await provider.chat(messages, tools, options);
      accumulator.callCount += 1;
      accumulator.inputTokens += response.usage.inputTokens;
      accumulator.outputTokens += response.usage.outputTokens;
      accumulator.calls.push({
        inputTokens: response.usage.inputTokens,
        messageCount: messages.length,
        outputTokens: response.usage.outputTokens,
        toolCount: tools?.length ?? 0,
      });
      return response;
    },
    async *chatStream(messages, tools) {
      let finalUsage: { inputTokens: number; outputTokens: number } | undefined;

      for await (const event of provider.chatStream(messages, tools)) {
        if (event.type === "message_end") {
          finalUsage = {
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
          };
        }
        yield event;
      }

      if (finalUsage) {
        accumulator.callCount += 1;
        accumulator.inputTokens += finalUsage.inputTokens;
        accumulator.outputTokens += finalUsage.outputTokens;
        accumulator.calls.push({
          inputTokens: finalUsage.inputTokens,
          messageCount: messages.length,
          outputTokens: finalUsage.outputTokens,
          toolCount: tools?.length ?? 0,
        });
      }
    },
    contextWindowSize: provider.contextWindowSize,
    maxOutputTokens: provider.maxOutputTokens,
  };
}




function evaluateCompactionEventPresence(
  compactEvents: Array<Extract<CanonicalAgentEvent, { type: "context.compacted" }>>
): MetricEvaluation {
  return {
    failureClass: "framework",
    note: `compactionEvents=${compactEvents.length}`,
    score: compactEvents.length >= 1 ? 1 : 0,
  };
}

function evaluateTokenSavings(
  compactEvent: Extract<CanonicalAgentEvent, { type: "context.compacted" }> | undefined
): MetricEvaluation {
  const shrunk =
    compactEvent !== undefined && compactEvent.originalMessages > compactEvent.compactedMessages;
  const savedTokens = (compactEvent?.estimatedTokensSaved ?? 0) > 0;

  return {
    failureClass: "framework",
    note: `original=${compactEvent?.originalMessages ?? 0}, compacted=${compactEvent?.compactedMessages ?? 0}, saved=${compactEvent?.estimatedTokensSaved ?? 0}`,
    score: ratio([shrunk, savedTokens]),
  };
}

function evaluateContextPreservation(output: string): MetricEvaluation {
  const codename = /orbit-lantern/i.test(output);
  const token = /pineapple-47/i.test(output);

  return {
    failureClass: "provider",
    note: `codename=${codename}, token=${token}, output=${JSON.stringify(output)}`,
    score: ratio([codename, token]),
  };
}

function evaluateUsageBounds(
  accumulator: UsageAccumulator,
  usage: ReturnType<typeof buildUsage>
): MetricEvaluation {
  const checks = [
    accumulator.callCount >= 2,
    accumulator.inputTokens <= INPUT_TOKEN_BUDGET,
    accumulator.outputTokens <= OUTPUT_TOKEN_BUDGET,
    usage.estimatedCostUsd < SOFT_SCENARIO_BUDGET_USD,
  ];

  return {
    failureClass: "provider",
    note: `calls=${accumulator.callCount}, inputTokens=${accumulator.inputTokens}, outputTokens=${accumulator.outputTokens}, estimatedCostUsd=${usage.estimatedCostUsd}`,
    score: ratio(checks),
  };
}

export const compactionScenario: Scenario<BenchmarkContext> = {
  description: "Triggers context compaction and verifies preserved critical facts.",
  name: "compaction",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(ctx) {
    const usageAccumulator: UsageAccumulator = {
      callCount: 0,
      calls: [],
      inputTokens: 0,
      outputTokens: 0,
    };

    const baseProvider = await ctx.createBedrockProvider({ maxOutputTokens: MAX_OUTPUT_TOKENS });
    const provider = createUsageTrackingProvider(baseProvider, usageAccumulator);

    const subject = agent({
      contextWindow: {
        compactionThreshold: COMPACTION_THRESHOLD,
        enabled: true,
        maxContextTokens: MAX_CONTEXT_TOKENS,
        pruneThreshold: 0.95,
        reserveOutputTokens: MAX_OUTPUT_TOKENS,
      },
      name: "compaction-benchmark",
      prompt:
        "You are a concise assistant. Preserve critical facts across context compaction and answer directly.",
    });

    const { events, result: output } = await ctx.collectAgentEvents(subject, (sessionId) =>
      subject.run(
        "What project codename and approval token were provided earlier? Reply briefly.",
        provider,
        {
          messages: buildHistory(),
          sessionId,
        }
      )
    );

    if (!events.every(isCanonicalEvent)) {
      throw new Error("compaction emitted non-canonical events");
    }

    const compactEvents = events.filter(
      (event): event is Extract<CanonicalAgentEvent, { type: "context.compacted" }> =>
        event.type === "context.compacted"
    );
    const compactEvent = compactEvents[0];
    const compactIndex = events.findIndex((event) => event.type === "context.compacted");
    const turnStartIndex = events.findIndex((event) => event.type === "turn.start");
    const turnEndIndex = events.findIndex((event) => event.type === "turn.end");
    const completeIndex = events.findIndex((event) => event.type === "agent.complete");
    const sessionEndIndex = events.findIndex((event) => event.type === "session.end");
    const sessionEnd = events.find(
      (event): event is Extract<CanonicalAgentEvent, { type: "session.end" }> =>
        event.type === "session.end"
    );

    if (
      compactIndex < 0 ||
      turnStartIndex <= compactIndex ||
      turnEndIndex <= turnStartIndex ||
      completeIndex <= turnEndIndex ||
      sessionEndIndex <= completeIndex
    ) {
      throw new Error(
        `invalid compaction ordering compact=${compactIndex} turnStart=${turnStartIndex} turnEnd=${turnEndIndex} complete=${completeIndex} sessionEnd=${sessionEndIndex}`
      );
    }

    if (sessionEnd?.status !== "complete") {
      throw new Error(`session.end status mismatch: ${sessionEnd?.status ?? "missing"}`);
    }

    const usage = buildUsage(usageAccumulator.inputTokens, usageAccumulator.outputTokens, {
      bounds: {
        inputTokensMax: INPUT_TOKEN_BUDGET,
        maxContextTokens: MAX_CONTEXT_TOKENS,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        outputTokensMax: OUTPUT_TOKEN_BUDGET,
        softBudgetUsd: SOFT_SCENARIO_BUDGET_USD,
      },
      callBreakdown: usageAccumulator.calls,
      compactionEvent: compactEvent,
      finalOutputText: output,
      modelId: ctx.modelId,
    });

    const evaluations = [
      evaluateCompactionEventPresence(compactEvents),
      evaluateTokenSavings(compactEvent),
      evaluateContextPreservation(output),
      evaluateUsageBounds(usageAccumulator, usage),
    ];

    for (const [index, evaluation] of evaluations.entries()) {
      assertMetric(SCORING_CRITERIA[index]!, evaluation);
    }
  },
};
