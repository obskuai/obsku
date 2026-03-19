import {
  type AgentDef,
  type CanonicalAgentEvent,
  type CheckpointBackend,
  crew,
  type InternalPlugin,
  run,
} from "@obsku/framework";
import { Effect } from "effect";
import { type BenchmarkContext, type EventSubscribable } from "../runner";
import { ratio } from "../scoring/scorer";
import { assertMetric, MetricEvaluation } from "../scoring/shared";
import type { Scenario, ScoringCriteria } from "../types";

const INPUT = "Analyze Project Alpha";

const SCORING_CRITERIA: ScoringCriteria[] = [
  {
    name: "sequential_execution",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1 / 3,
  },
  {
    name: "task_chaining",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1 / 3,
  },
  {
    name: "output_content",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1 / 3,
  },
];

const lookupTool: InternalPlugin = {
  description: "Look up deterministic Project Alpha facts.",
  execute: () =>
    Effect.succeed({
      facts: ["Project Alpha started in 2020", "Budget: $1M", "Team size: 5"],
    }),
  name: "lookup",
  params: {},
};

const scoreItemTool: InternalPlugin = {
  description: "Return deterministic Project Alpha score.",
  execute: () =>
    Effect.succeed({
      rating: "high",
      score: 8.5,
    }),
  name: "score_item",
  params: {},
};

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

function getNodeOutput(result: Awaited<ReturnType<typeof run>>, nodeId: string): string {
  if (result.status !== "Complete") {
    return "";
  }

  const nodeResult = result.results[nodeId];
  return nodeResult?.status === "Complete" ? String(nodeResult.output) : "";
}

function getReporterOutput(result: Awaited<ReturnType<typeof run>>): string {
  if (result.status !== "Complete") {
    return "";
  }

  const reporterResult = result.results.reporter;
  return reporterResult?.status === "Complete" ? String(reporterResult.output) : "";
}

function evaluateSequentialExecution(events: CanonicalAgentEvent[]): MetricEvaluation {
  const starts = ["researcher", "analyst", "reporter"].map((nodeId) =>
    getEventIndex(events, (event) => event.type === "graph.node.start" && event.nodeId === nodeId)
  );
  const completes = ["researcher", "analyst", "reporter"].map((nodeId) =>
    getEventIndex(
      events,
      (event) => event.type === "graph.node.complete" && event.nodeId === nodeId
    )
  );

  const checks = [
    starts.every((index) => index >= 0),
    completes.every((index) => index >= 0),
    starts[0]! < starts[1]! && starts[1]! < starts[2]!,
    completes[0]! < completes[1]! && completes[1]! < completes[2]!,
  ];

  return {
    failureClass: "framework",
    note: `starts=${starts.join(",")}, completes=${completes.join(",")}`,
    score: ratio(checks),
  };
}

function evaluateTaskChaining(
  analystOutput: string,
  reporterOutput: string,
  finalOutput: string
): MetricEvaluation {
  const analystReceivedResearch =
    analystOutput.includes("Project Alpha") &&
    (analystOutput.includes("2020") || analystOutput.includes("$1M"));
  const reporterReceivedAnalysis =
    reporterOutput.includes("8.5") || /\bhigh\b/i.test(reporterOutput);
  const finalCarriesForwardFacts =
    finalOutput.includes("Project Alpha") &&
    (finalOutput.includes("2020") || finalOutput.includes("$1M"));

  return {
    failureClass:
      analystReceivedResearch && reporterReceivedAnalysis && !finalCarriesForwardFacts
        ? "provider"
        : "framework",
    note:
      `analystOutput=${JSON.stringify(analystOutput)}, ` +
      `reporterOutput=${JSON.stringify(reporterOutput)}, ` +
      `finalOutput=${JSON.stringify(finalOutput)}`,
    score: ratio([analystReceivedResearch, reporterReceivedAnalysis, finalCarriesForwardFacts]),
  };
}

function evaluateOutputContent(finalOutput: string): MetricEvaluation {
  const hasProject = /Project Alpha/i.test(finalOutput);
  const hasFact = /2020|\$1M/i.test(finalOutput);
  const hasScore = /8\.5|\bhigh\b/i.test(finalOutput);

  return {
    failureClass: "provider",
    note: `hasProject=${hasProject}, hasFact=${hasFact}, hasScore=${hasScore}, output=${JSON.stringify(finalOutput)}`,
    score: ratio([hasProject, hasFact, hasScore]),
  };
}

export const crewScenario: Scenario<BenchmarkContext> = {
  description: "Sequential crew benchmark with deterministic research, analysis, and reporting.",
  name: "crew",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(ctx) {
    const provider = await ctx.createBedrockProvider({ maxOutputTokens: 512 });
    const checkpointStore = ctx.checkpointStore as CheckpointBackend;
    const streamSubject = createEventSubscribable();

    const researcher: AgentDef = {
      maxIterations: 3,
      name: "researcher",
      prompt:
        "You are researcher. Use the lookup tool exactly once. Then respond with a concise research note that explicitly includes: Project Alpha started in 2020; Budget: $1M; Team size: 5.",
      streaming: true,
      tools: [lookupTool],
    };

    const analyst: AgentDef = {
      maxIterations: 3,
      name: "analyst",
      prompt:
        "You are analyst. Read the prior research note. Use the score_item tool exactly once. Then produce a concise analysis that preserves the key facts and explicitly includes: score 8.5 and rating high.",
      streaming: true,
      tools: [scoreItemTool],
    };

    const reporter: AgentDef = {
      maxIterations: 3,
      name: "reporter",
      prompt:
        "You are reporter. Summarize the prior analysis in 2-3 sentences. Mention Project Alpha, at least one concrete fact from the research, and the analyst result score 8.5 with rating high.",
      streaming: true,
    };

    const emitEvent = (event: unknown) => {
      streamSubject.emit(event);
    };

    const subject = crew({
      members: [
        {
          agent: researcher,
          task: "Research Project Alpha and gather factual inputs for the analyst.",
        },
        { agent: analyst, task: "Analyze the researcher output and score Project Alpha." },
        { agent: reporter, task: "Write the final report from the analyst output." },
      ],
      name: "crew-benchmark",
      process: "sequential",
      provider,
    });

    try {
      const { events, result } = await ctx.collectAgentEvents(streamSubject, (sessionId) =>
        run(subject, {
          checkpointStore,
          input: INPUT,
          onEvent: emitEvent,
          sessionId,
        })
      );

      if (result.status !== "Complete") {
        throw new Error(`crew status mismatch: ${result.status}`);
      }

      const analystOutput = getNodeOutput(result, "analyst");
      const reporterOutput = getNodeOutput(result, "reporter");
      const finalOutput = getReporterOutput(result);
      const evaluations = [
        evaluateSequentialExecution(events),
        evaluateTaskChaining(analystOutput, reporterOutput, finalOutput),
        evaluateOutputContent(finalOutput),
      ];

      for (const [index, evaluation] of evaluations.entries()) {
        assertMetric(SCORING_CRITERIA[index]!, evaluation);
      }
    } finally {
      streamSubject.close();
    }
  },
};
