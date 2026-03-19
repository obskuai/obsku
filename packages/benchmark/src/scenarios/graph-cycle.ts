import {
  agent,
  type CanonicalAgentEvent,
  type CheckpointBackend,
  type GraphNode,
  graph,
  type InternalPlugin,
  run,
} from "@obsku/framework";
import { Effect } from "effect";
import { type BenchmarkContext, type EventSubscribable } from "../runner";
import { ratio } from "../scoring/scorer";
import { assertMetric, MetricEvaluation } from "../scoring/shared";
import type { Scenario, ScoringCriteria } from "../types";

const INPUT =
  "Draft a short product update, then review it. Keep iterating until the review score reaches at least 0.8, then finish.";

const SCORING_CRITERIA: ScoringCriteria[] = [
  { name: "cycle_execution", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  { name: "iteration_bound", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  { name: "convergence", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  { name: "event_lifecycle", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
];

function node(id: string, executor: GraphNode["executor"]): GraphNode {
  return { executor, id };
}

function createEventSubscribable(): EventSubscribable & {
  close(): void;
  emit(event: unknown): void;
} {
  const queue: unknown[] = [];
  let closed = false;
  let notify: (() => void) | undefined;

  const wake = () => {
    notify?.();
    notify = undefined;
  };

  return {
    close() {
      closed = true;
      wake();
    },
    emit(event: unknown) {
      queue.push(event);
      wake();
    },
    async subscribe(): Promise<AsyncIterable<unknown>> {
      return {
        [Symbol.asyncIterator]: async function* () {
          while (!closed || queue.length > 0) {
            if (queue.length === 0) {
              await new Promise<void>((resolve) => {
                notify = resolve;
              });
              continue;
            }

            yield queue.shift();
          }
        },
      };
    },
  };
}

function getCycleEvents<TType extends "graph.cycle.start" | "graph.cycle.complete">(
  events: CanonicalAgentEvent[],
  type: TType
): Array<Extract<CanonicalAgentEvent, { type: TType }>> {
  return events.filter(
    (event): event is Extract<CanonicalAgentEvent, { type: TType }> => event.type === type
  );
}

function evaluateCycleExecution(events: CanonicalAgentEvent[]): MetricEvaluation {
  const starts = getCycleEvents(events, "graph.cycle.start");
  const completes = getCycleEvents(events, "graph.cycle.complete");
  const cycleCount = Math.min(starts.length, completes.length);

  return {
    failureClass: "framework",
    note: `starts=${starts.length}, completes=${completes.length}, cycles=${cycleCount}`,
    score: ratio([cycleCount >= 2]),
  };
}

function evaluateIterationBound(events: CanonicalAgentEvent[]): MetricEvaluation {
  const starts = getCycleEvents(events, "graph.cycle.start");
  const completes = getCycleEvents(events, "graph.cycle.complete");
  const bounded = starts.length <= 3 && completes.length <= 3;

  return {
    failureClass: "framework",
    note: `starts=${starts.length}, completes=${completes.length}, max=3`,
    score: ratio([bounded]),
  };
}

function evaluateConvergence(scores: number[]): MetricEvaluation {
  const first = scores[0];
  const last = scores.at(-1);
  const converged =
    typeof first === "number" && typeof last === "number" && scores.length >= 2 && last > first;

  return {
    failureClass: "framework",
    note: `scores=${scores.join(",")}`,
    score: ratio([converged]),
  };
}

function evaluateEventLifecycle(events: CanonicalAgentEvent[]): MetricEvaluation {
  const starts = getCycleEvents(events, "graph.cycle.start");
  const completes = getCycleEvents(events, "graph.cycle.complete");
  let completeIndex = 0;

  const ordered = starts.every((start) => {
    const nextComplete = completes[completeIndex];
    if (!nextComplete) {
      return false;
    }

    const matches =
      nextComplete.from === start.from &&
      nextComplete.to === start.to &&
      nextComplete.iteration === start.iteration &&
      nextComplete.timestamp >= start.timestamp;

    if (matches) {
      completeIndex += 1;
    }

    return matches;
  });

  const paired = starts.length === completes.length;

  return {
    failureClass: "framework",
    note: `starts=${starts.length}, completes=${completes.length}, ordered=${ordered}`,
    score: ratio([paired, ordered]),
  };
}

export const graphCycleScenario: Scenario<BenchmarkContext> = {
  description:
    "Cyclic draft-review graph with deterministic convergence and cycle lifecycle checks.",
  name: "graph-cycle",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(ctx) {
    const provider = await ctx.createBedrockProvider({ maxOutputTokens: 256 });
    const checkpointStore = ctx.checkpointStore as unknown as CheckpointBackend;
    const streamSubject = createEventSubscribable();
    const scoreHistory: number[] = [];
    let draftIteration = 0;
    let reviewIteration = 0;

    const writeDraftTool: InternalPlugin = {
      description: "Write a deterministic draft for the current iteration.",
      execute: () => {
        draftIteration += 1;
        return Effect.succeed({ draft: `Draft content for iteration ${draftIteration}` });
      },
      name: "write_draft",
      params: {},
    };

    const scoreDraftTool: InternalPlugin = {
      description: "Score the current draft deterministically.",
      execute: () => {
        reviewIteration += 1;
        const score = reviewIteration === 1 ? 0.3 : reviewIteration === 2 ? 0.7 : 0.9;
        scoreHistory.push(score);
        return Effect.succeed({
          feedback:
            score < 0.8
              ? `Needs another revision after review ${reviewIteration}`
              : `Quality threshold met at review ${reviewIteration}`,
          score,
        });
      },
      name: "score_draft",
      params: {},
    };

    const draftAgent = agent({
      maxIterations: 2,
      name: "graph-cycle-draft",
      prompt:
        "You are the draft node. Use write_draft exactly once. Then answer exactly as 'DRAFT_READY: <draft text>'.",
      tools: [writeDraftTool],
    });

    const reviewAgent = agent({
      maxIterations: 2,
      name: "graph-cycle-review",
      prompt:
        "You are the review node. Use score_draft exactly once. If score < 0.8, answer exactly 'CONTINUE | score=<score> | feedback=<feedback>'. If score >= 0.8, answer exactly 'FINISH | score=<score> | feedback=<feedback>'.",
      tools: [scoreDraftTool],
    });

    const emitEvent = (event: unknown) => {
      streamSubject.emit(event);
    };

    try {
      const { events, result } = await ctx.collectAgentEvents(streamSubject, async () => {
        const subject = graph({
          edges: [
            { from: "draft", to: "review" },
            {
              condition: (result) => /^CONTINUE\b/.test(String(result)),
              from: "review",
              maxIterations: 3,
              to: "draft",
              back: true,
            },
          ],
          entry: "draft",
          nodes: [
            node("draft", async (input) =>
              draftAgent.run(String(input), provider, {
                checkpointStore,
                onEvent: emitEvent,
                sessionId: ctx.frameworkSessionId,
              })
            ),
            node("review", async (input) =>
              reviewAgent.run(String(input), provider, {
                checkpointStore,
                onEvent: emitEvent,
                sessionId: ctx.frameworkSessionId,
              })
            ),
          ],
          onEvent: emitEvent,
          provider,
        });

        return run(subject, {
          checkpointStore,
          input: INPUT,
          onEvent: emitEvent,
          sessionId: ctx.frameworkSessionId,
        });
      });

      if (result.status !== "Complete") {
        throw new Error(`graph-cycle status mismatch: ${result.status}`);
      }

      const finalReview = result.results.review;
      if (finalReview?.status !== "Complete") {
        throw new Error(`graph-cycle review status mismatch: ${finalReview?.status ?? "missing"}`);
      }

      if (!/^FINISH\b/.test(String(finalReview.output))) {
        throw new Error(`graph-cycle review did not finish: ${String(finalReview.output)}`);
      }

      const evaluations = [
        evaluateCycleExecution(events),
        evaluateIterationBound(events),
        evaluateConvergence(scoreHistory),
        evaluateEventLifecycle(events),
      ];

      for (const [index, evaluation] of evaluations.entries()) {
        assertMetric(SCORING_CRITERIA[index]!, evaluation);
      }
    } finally {
      streamSubject.close();
    }
  },
};
