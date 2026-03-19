import {
  type CanonicalAgentEvent,
  type CheckpointBackend,
  type GraphNode,
  graph,
  run,
} from "@obsku/framework";
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

function extractReviewScore(output: unknown): number | null {
  const text = String(output);
  const match = text.match(/score\s*[=:]\s*(0(?:\.\d+)?|1(?:\.0+)?)/i);
  return match ? Number(match[1]) : null;
}

function reviewWantsContinue(output: unknown): boolean {
  const text = String(output);
  const score = extractReviewScore(text);
  return (
    /\bCONTINUE\b/i.test(text) ||
    /needs another revision/i.test(text) ||
    (score !== null && score < 0.8)
  );
}

function reviewWantsFinish(output: unknown): boolean {
  const text = String(output);
  const score = extractReviewScore(text);
  return (
    /\bFINISH\b/i.test(text) ||
    /quality threshold met/i.test(text) ||
    (score !== null && score >= 0.8)
  );
}

export const graphCycleScenario: Scenario<BenchmarkContext> = {
  description:
    "Cyclic draft-review graph with deterministic convergence and cycle lifecycle checks.",
  name: "graph-cycle",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(ctx) {
    const checkpointStore = ctx.checkpointStore as unknown as CheckpointBackend;
    const streamSubject = createEventSubscribable();
    const scoreHistory: number[] = [];
    let draftIteration = 0;
    let reviewIteration = 0;

    const emitEvent = (event: unknown) => {
      streamSubject.emit(event);
    };

    try {
      const { events, result } = await ctx.collectAgentEvents(streamSubject, async () => {
        const subject = graph({
          edges: [
            { from: "draft", to: "review" },
            {
              condition: (result) => reviewWantsContinue(result),
              from: "review",
              maxIterations: 3,
              to: "draft",
              back: true,
            },
          ],
          entry: "draft",
          nodes: [
            node("draft", async () => {
              draftIteration += 1;
              return `DRAFT_READY: Draft content for iteration ${draftIteration}`;
            }),
            node("review", async (input) => {
              void input;
              reviewIteration += 1;
              const score = reviewIteration === 1 ? 0.3 : reviewIteration === 2 ? 0.7 : 0.9;
              scoreHistory.push(score);
              const feedback =
                score < 0.8
                  ? `Needs another revision after review ${reviewIteration}`
                  : `Quality threshold met at review ${reviewIteration}`;
              return score < 0.8
                ? `CONTINUE | score=${score} | feedback=${feedback}`
                : `FINISH | score=${score} | feedback=${feedback}`;
            }),
          ],
          onEvent: emitEvent,
          provider: await ctx.createBedrockProvider({ maxOutputTokens: 256 }),
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

      if (!reviewWantsFinish(finalReview.output)) {
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
