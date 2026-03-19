import {
  type AgentCompleteEvent,
  agent,
  type CanonicalAgentEvent,
  type InternalPlugin,
  type SessionEndEvent,
  type SessionStartEvent,
  type ToolCallEvent,
  type ToolResultEvent,
} from "@obsku/framework";
import { Effect } from "effect";
import { type BenchmarkContext, providerInstability } from "../runner";
import { ratio } from "../scoring/scorer";
import { assertMetric, MetricEvaluation, isCanonicalEvent } from "../scoring/shared";
import type { Scenario, ScoringCriteria } from "../types";

const INPUT =
  "Call echo once with text 'hello'. Then call add once with a=2 and b=2. After both tool results, answer briefly with the greeting and sum.";

const SCORING_CRITERIA: ScoringCriteria[] = [
  { name: "turn_lifecycle", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  { name: "tool_pairing", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  { name: "usage_tracking", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  { name: "output_content", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
];



function getEventIndex(
  events: CanonicalAgentEvent[],
  predicate: (event: CanonicalAgentEvent) => boolean,
  startIndex = 0
): number {
  for (let index = startIndex; index < events.length; index++) {
    if (predicate(events[index]!)) {
      return index;
    }
  }

  return -1;
}



function evaluateTurnLifecycle(events: CanonicalAgentEvent[]): MetricEvaluation {
  const turnStarts = events.filter(
    (event): event is Extract<CanonicalAgentEvent, { type: "turn.start" }> =>
      event.type === "turn.start"
  );

  if (turnStarts.length === 0) {
    return {
      failureClass: "framework",
      note: "missing turn.start events",
      score: 0,
    };
  }

  const completeTurns = turnStarts.filter((turnStart) => {
    const streamStartIndex = getEventIndex(
      events,
      (event) => event.type === "stream.start" && event.turnId === turnStart.turnId
    );
    const streamEndIndex = getEventIndex(
      events,
      (event) => event.type === "stream.end" && event.turnId === turnStart.turnId,
      streamStartIndex >= 0 ? streamStartIndex + 1 : 0
    );
    const turnEndIndex = getEventIndex(
      events,
      (event) => event.type === "turn.end" && event.turnId === turnStart.turnId,
      streamEndIndex >= 0 ? streamEndIndex + 1 : 0
    );

    return (
      streamStartIndex > -1 && streamEndIndex > streamStartIndex && turnEndIndex > streamEndIndex
    );
  }).length;

  return {
    failureClass: "framework",
    note: `complete turn lifecycles=${completeTurns}/${turnStarts.length}`,
    score: completeTurns / turnStarts.length,
  };
}

function evaluateToolPairing(events: CanonicalAgentEvent[]): MetricEvaluation {
  const calls = events.filter((event): event is ToolCallEvent => event.type === "tool.call");
  const results = events.filter((event): event is ToolResultEvent => event.type === "tool.result");
  const matchedCalls = calls.every(
    (call) => results.filter((result) => result.toolUseId === call.toolUseId).length === 1
  );
  const callIds = new Set(calls.map((event) => event.toolUseId));
  const matchedResults = results.every((result) => callIds.has(result.toolUseId));
  const sawEcho = calls.some((call) => call.toolName === "echo" && call.args.text === "hello");
  const sawAdd = calls.some(
    (call) => call.toolName === "add" && call.args.a === 2 && call.args.b === 2
  );

  return {
    failureClass: matchedCalls && matchedResults ? "provider" : "framework",
    note: `matchedCalls=${matchedCalls}, matchedResults=${matchedResults}, echo=${sawEcho}, add=${sawAdd}`,
    score: ratio([matchedCalls, matchedResults, sawEcho, sawAdd]),
  };
}

function evaluateUsageTracking(events: CanonicalAgentEvent[]): MetricEvaluation {
  const usage = [...events]
    .reverse()
    .find((event): event is AgentCompleteEvent => event.type === "agent.complete")?.usage;
  const llmCalls = (usage?.llmCalls ?? 0) > 0;
  const inputTokens = (usage?.totalInputTokens ?? 0) > 0;
  const outputTokens = (usage?.totalOutputTokens ?? 0) > 0;

  return {
    failureClass: "framework",
    note: `llmCalls=${usage?.llmCalls ?? 0}, inputTokens=${usage?.totalInputTokens ?? 0}, outputTokens=${usage?.totalOutputTokens ?? 0}`,
    score: ratio([llmCalls, inputTokens, outputTokens]),
  };
}

function evaluateOutputContent(output: string): MetricEvaluation {
  const greeting = /\b(hello|hi)\b/i.test(output);
  const sum = /\b4\b|\bfour\b/i.test(output);

  return {
    failureClass: "provider",
    note: `greeting=${greeting}, sum=${sum}, output=${JSON.stringify(output)}`,
    score: ratio([greeting, sum]),
  };
}

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

const addTool: InternalPlugin = {
  description: "Add two integers deterministically.",
  execute: (input) =>
    Effect.succeed({
      sum: Number(input.a ?? 0) + Number(input.b ?? 0),
    }),
  name: "add",
  params: {
    a: { required: true, type: "number" },
    b: { required: true, type: "number" },
  },
};

export const coreAgentScenario: Scenario<BenchmarkContext> = {
  description: "Basic agent loop with deterministic echo/add tool use.",
  name: "core-agent",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(ctx) {
    const provider = await ctx.createBedrockProvider({ maxOutputTokens: 512 });

    const subject = agent({
      name: "core-agent-benchmark",
      prompt:
        "You are a concise assistant. Always execute required tools before answering. Do not invent tool results.",
      streaming: true,
      tools: [echoTool, addTool],
    });

    const { events, result: finalOutput } = await ctx.collectAgentEvents(subject, (sessionId) =>
      subject.run(INPUT, provider, { sessionId })
    );

    if (!events.length || !events.every(isCanonicalEvent)) {
      throw new Error("core-agent emitted no canonical events");
    }

    const sessionStarts = events.filter(
      (event): event is SessionStartEvent => event.type === "session.start"
    );
    const sessionEnds = events.filter(
      (event): event is SessionEndEvent => event.type === "session.end"
    );

    if (sessionStarts.length !== 1 || sessionEnds.length !== 1) {
      throw new Error(
        `expected one session.start and one session.end, got ${sessionStarts.length}/${sessionEnds.length}`
      );
    }

    if (sessionStarts[0]?.input !== INPUT) {
      throw new Error("session.start input mismatch");
    }

    if (sessionEnds[0]?.status !== "complete") {
      throw new Error(`session.end status mismatch: ${sessionEnds[0]?.status ?? "missing"}`);
    }

    const evaluations = [
      evaluateTurnLifecycle(events),
      evaluateToolPairing(events),
      evaluateUsageTracking(events),
      evaluateOutputContent(finalOutput),
    ];

    for (const [index, evaluation] of evaluations.entries()) {
      assertMetric(SCORING_CRITERIA[index]!, evaluation);
    }
  },
};
