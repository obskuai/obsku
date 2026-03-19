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
  "Compute: multiply 3*4, subtract 10-3, add 5+6. Workers will handle each computation.";

const SCORING_CRITERIA: ScoringCriteria[] = [
  { name: "wave_ordering", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  {
    name: "parallel_dispatch",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 0.25,
  },
  {
    name: "result_aggregation",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 0.25,
  },
  {
    name: "output_quality",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 0.25,
  },
];

const multiplyTool: InternalPlugin = {
  description: "Multiply two integers deterministically.",
  execute: (input) =>
    Effect.succeed({
      product: Number(input.a ?? 0) * Number(input.b ?? 0),
    }),
  name: "multiply",
  params: {
    a: { required: true, type: "number" },
    b: { required: true, type: "number" },
  },
};

const subtractTool: InternalPlugin = {
  description: "Subtract two integers deterministically.",
  execute: (input) =>
    Effect.succeed({
      difference: Number(input.a ?? 0) - Number(input.b ?? 0),
    }),
  name: "subtract",
  params: {
    a: { required: true, type: "number" },
    b: { required: true, type: "number" },
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

function getEventIndex(
  events: CanonicalAgentEvent[],
  predicate: (event: CanonicalAgentEvent) => boolean,
  startIndex = 0
): number {
  for (let index = startIndex; index < events.length; index += 1) {
    if (predicate(events[index]!)) {
      return index;
    }
  }

  return -1;
}

function getNodeEventIndex(
  events: CanonicalAgentEvent[],
  type: "graph.node.start" | "graph.node.complete",
  nodeId: string
): number {
  return getEventIndex(events, (event) => event.type === type && event.nodeId === nodeId);
}

function getMergeOutput(result: Awaited<ReturnType<typeof run>>): string {
  if (result.status !== "Complete") {
    return "";
  }

  const mergeResult = result.results.merge;
  return mergeResult?.status === "Complete" ? String(mergeResult.output) : "";
}

function evaluateWaveOrdering(events: CanonicalAgentEvent[]): MetricEvaluation {
  const splitComplete = getNodeEventIndex(events, "graph.node.complete", "split");
  const workerStarts = ["worker-a", "worker-b", "worker-c"].map((nodeId) =>
    getNodeEventIndex(events, "graph.node.start", nodeId)
  );
  const workerCompletes = ["worker-a", "worker-b", "worker-c"].map((nodeId) =>
    getNodeEventIndex(events, "graph.node.complete", nodeId)
  );
  const mergeStart = getNodeEventIndex(events, "graph.node.start", "merge");
  const checks = [
    splitComplete >= 0,
    workerStarts.every((index) => index > splitComplete),
    workerCompletes.every((index) => index >= 0),
    mergeStart > Math.max(...workerCompletes),
  ];

  return {
    failureClass: "framework",
    note: `splitComplete=${splitComplete}, workerStarts=${workerStarts.join(",")}, workerCompletes=${workerCompletes.join(",")}, mergeStart=${mergeStart}`,
    score: ratio(checks),
  };
}

function evaluateParallelDispatch(events: CanonicalAgentEvent[]): MetricEvaluation {
  const workerStarts = ["worker-a", "worker-b", "worker-c"].map((nodeId) =>
    getNodeEventIndex(events, "graph.node.start", nodeId)
  );
  const workerCompletes = ["worker-a", "worker-b", "worker-c"].map((nodeId) =>
    getNodeEventIndex(events, "graph.node.complete", nodeId)
  );
  const latestStart = Math.max(...workerStarts);
  const earliestComplete = Math.min(...workerCompletes);
  const checks = [
    workerStarts.every((index) => index >= 0),
    workerCompletes.every((index) => index >= 0),
    latestStart < earliestComplete,
  ];

  return {
    failureClass: "framework",
    note: `workerStarts=${workerStarts.join(",")}, workerCompletes=${workerCompletes.join(",")}, latestStart=${latestStart}, earliestComplete=${earliestComplete}`,
    score: ratio(checks),
  };
}

function evaluateResultAggregation(output: string): MetricEvaluation {
  const checks = [
    /worker-a/i.test(output) && /12\b/.test(output),
    /worker-b/i.test(output) && /7\b/.test(output),
    /worker-c/i.test(output) && /11\b/.test(output),
  ];

  return {
    failureClass: "provider",
    note: `output=${JSON.stringify(output)}`,
    score: ratio(checks),
  };
}

function evaluateOutputQuality(output: string): MetricEvaluation {
  const checks = [
    /multiply\s*3\s*\*\s*4\s*=\s*12|12\b/i.test(output),
    /subtract\s*10\s*-\s*3\s*=\s*7|7\b/i.test(output),
    /add\s*5\s*\+\s*6\s*=\s*11|11\b/i.test(output),
  ];

  return {
    failureClass: "provider",
    note: `output=${JSON.stringify(output)}`,
    score: ratio(checks),
  };
}

export const graphParallelScenario: Scenario<BenchmarkContext> = {
  description: "Wave-based parallel graph execution across split, workers, and merge.",
  name: "graph-parallel",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(ctx) {
    const provider = await ctx.createBedrockProvider({ maxOutputTokens: 512 });
    const checkpointStore = ctx.checkpointStore as CheckpointBackend;
    const streamSubject = createEventSubscribable();

    const splitAgent = agent({
      maxIterations: 2,
      name: "graph-parallel-split",
      prompt:
        "You are the planner node. Convert the user request into a concise plan that assigns exactly one computation to worker-a, worker-b, and worker-c. Mention the numeric operations explicitly.",
    });

    const workerAAgent = agent({
      maxIterations: 2,
      name: "graph-parallel-worker-a",
      prompt:
        "You are worker-a. Use the multiply tool exactly once for 3 and 4. Then answer exactly in the form 'worker-a result: multiply 3*4 = 12'.",
      tools: [multiplyTool],
    });

    const workerBAgent = agent({
      maxIterations: 2,
      name: "graph-parallel-worker-b",
      prompt:
        "You are worker-b. Use the subtract tool exactly once for 10 and 3. Then answer exactly in the form 'worker-b result: subtract 10-3 = 7'.",
      tools: [subtractTool],
    });

    const workerCAgent = agent({
      maxIterations: 2,
      name: "graph-parallel-worker-c",
      prompt:
        "You are worker-c. Use the add tool exactly once for 5 and 6. Then answer exactly in the form 'worker-c result: add 5+6 = 11'.",
      tools: [addTool],
    });

    const mergeAgent = agent({
      maxIterations: 2,
      name: "graph-parallel-merge",
      prompt:
        "You are the merge node. Combine all worker outputs into a concise summary. Include worker-a, worker-b, and worker-c by name, preserve each computed value, and end with a short final summary sentence.",
    });

    const emitEvent = (event: unknown) => {
      streamSubject.emit(event);
    };

    try {
      const { events, result } = await ctx.collectAgentEvents(streamSubject, async () => {
        const subject = graph({
          edges: [
            { from: "split", to: "worker-a" },
            { from: "split", to: "worker-b" },
            { from: "split", to: "worker-c" },
            { from: "worker-a", to: "merge" },
            { from: "worker-b", to: "merge" },
            { from: "worker-c", to: "merge" },
          ],
          entry: "split",
          nodes: [
            node("split", async (input) =>
              splitAgent.run(String(input), provider, {
                checkpointStore,
                onEvent: emitEvent,
                sessionId: ctx.frameworkSessionId,
              })
            ),
            node("worker-a", async (input) =>
              workerAAgent.run(String(input), provider, {
                checkpointStore,
                onEvent: emitEvent,
                sessionId: ctx.frameworkSessionId,
              })
            ),
            node("worker-b", async (input) =>
              workerBAgent.run(String(input), provider, {
                checkpointStore,
                onEvent: emitEvent,
                sessionId: ctx.frameworkSessionId,
              })
            ),
            node("worker-c", async (input) =>
              workerCAgent.run(String(input), provider, {
                checkpointStore,
                onEvent: emitEvent,
                sessionId: ctx.frameworkSessionId,
              })
            ),
            node("merge", async (input) =>
              mergeAgent.run(String(input), provider, {
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
        throw new Error(`graph-parallel status mismatch: ${result.status}`);
      }

      const mergeOutput = getMergeOutput(result);
      const evaluations = [
        evaluateWaveOrdering(events),
        evaluateParallelDispatch(events),
        evaluateResultAggregation(mergeOutput),
        evaluateOutputQuality(mergeOutput),
      ];

      for (const [index, evaluation] of evaluations.entries()) {
        assertMetric(SCORING_CRITERIA[index]!, evaluation);
      }
    } finally {
      streamSubject.close();
    }
  },
};
