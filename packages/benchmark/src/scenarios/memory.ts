import { agent, type CanonicalAgentEvent, type MemoryStoreOperations } from "@obsku/framework";
import { type BenchmarkContext } from "../runner";
import { ratio } from "../scoring/scorer";
import { assertMetric, MetricEvaluation } from "../scoring/shared";
import type { Scenario, ScoringCriteria } from "../types";

const PHASE1_INPUT = "Remember: the server IP is 10.0.0.42 and the admin is Alice. Confirm.";
const PHASE2_INPUT = "What is the server IP and who is the admin?";

const SCORING_CRITERIA: ScoringCriteria[] = [
  {
    name: "entity_extraction",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 0.25,
  },
  {
    name: "context_injection",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 0.25,
  },
  {
    name: "fact_persistence",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 0.25,
  },
  {
    name: "recall_accuracy",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 0.25,
  },
];

type MemoryLoadEvent = Extract<CanonicalAgentEvent, { type: "memory.load" }>;
type MemorySaveEvent = Extract<CanonicalAgentEvent, { type: "memory.save" }>;

function getMemoryLoadEvents(events: readonly CanonicalAgentEvent[]): MemoryLoadEvent[] {
  return events.filter((event): event is MemoryLoadEvent => event.type === "memory.load");
}

function getMemorySaveEvents(events: readonly CanonicalAgentEvent[]): MemorySaveEvent[] {
  return events.filter((event): event is MemorySaveEvent => event.type === "memory.save");
}

function evaluateEntityExtraction(events: readonly CanonicalAgentEvent[]): MetricEvaluation {
  const saves = getMemorySaveEvents(events);

  return {
    failureClass: "framework",
    note: `memorySaveEvents=${saves.length}`,
    score: saves.length >= 1 ? 1 : 0,
  };
}

function evaluateContextInjection(phase2Events: readonly CanonicalAgentEvent[]): MetricEvaluation {
  const loads = getMemoryLoadEvents(phase2Events);
  const loadsWithMessages = loads.filter((event) => event.messageCount > 0);

  return {
    failureClass: "framework",
    note: `phase2MemoryLoads=${loads.length}, withMessages=${loadsWithMessages.length}`,
    score: loadsWithMessages.length >= 1 ? 1 : 0,
  };
}

function evaluateFactPersistence(
  phase2Events: readonly CanonicalAgentEvent[],
  phase2Output: string
): MetricEvaluation {
  const loads = getMemoryLoadEvents(phase2Events);
  const loadsWithMessages = loads.filter((event) => event.messageCount > 0);
  const phase2Succeeded = phase2Output.trim().length > 0;

  return {
    failureClass: "framework",
    note: `phase2MemoryLoads=${loads.length}, withMessages=${loadsWithMessages.length}, outputLength=${phase2Output.length}`,
    score: ratio([loads.length > 0, loadsWithMessages.length > 0, phase2Succeeded]),
  };
}

function evaluateRecallAccuracy(output: string): MetricEvaluation {
  const ipMatch = output.includes("10.0.0.42");
  const adminMatch = /\bAlice\b/i.test(output);

  return {
    failureClass: "provider",
    note: `ip=${ipMatch}, admin=${adminMatch}, output=${JSON.stringify(output)}`,
    score: ratio([ipMatch, adminMatch]),
  };
}

export const memoryScenario: Scenario<BenchmarkContext> = {
  description: "Memory lifecycle benchmark for extraction, persistence, injection, and recall.",
  name: "memory",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(ctx) {
    const provider = await ctx.createBedrockProvider({ maxOutputTokens: 256 });

    const subject = agent({
      memory: {
        contextInjection: true,
        enabled: true,
        entityMemory: true,
        longTermMemory: true,
        store: ctx.checkpointStore as unknown as MemoryStoreOperations,
      },
      name: "memory-benchmark",
      prompt:
        "You are a helpful assistant with memory. Remember factual details accurately and recall them exactly when asked later in the same session.",
      streaming: true,
    });

    const { events: phase1Events } = await ctx.collectAgentEvents(subject, () =>
      subject.run(PHASE1_INPUT, provider, { sessionId: ctx.frameworkSessionId })
    );
    const { events: phase2Events, result: phase2Output } = await ctx.collectAgentEvents(
      subject,
      () => subject.run(PHASE2_INPUT, provider, { sessionId: ctx.frameworkSessionId })
    );

    const recallOutput = String(phase2Output);
    const evaluations = [
      evaluateEntityExtraction(phase1Events),
      evaluateContextInjection(phase2Events),
      evaluateFactPersistence(phase2Events, recallOutput),
      evaluateRecallAccuracy(recallOutput),
    ];

    for (const [index, evaluation] of evaluations.entries()) {
      assertMetric(SCORING_CRITERIA[index]!, evaluation);
    }
  },
};
