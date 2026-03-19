import { SqliteCheckpointStore } from "@obsku/checkpoint-sqlite";
import {
  agent,
  type CanonicalAgentEvent,
  type Checkpoint,
  type CheckpointBackend,
  type GraphNode,
  graph,
  interrupt,
  type LLMProvider,
  resumeGraph,
  run,
} from "@obsku/framework";
import { type BenchmarkContext, type EventSubscribable } from "../runner";
import { ratio } from "../scoring/scorer";
import { assertMetric, MetricEvaluation } from "../scoring/shared";
import type { Scenario, ScoringCriteria } from "../types";

const NAMESPACE = "checkpoint-resume";
const REMEMBER_INPUT =
  "Remember that my favorite color is blue. Acknowledge briefly that you'll remember it.";
const RECALL_INPUT = "What is my favorite color? Answer briefly.";

const SCORING_CRITERIA: ScoringCriteria[] = [
  {
    name: "checkpoint_events",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1 / 3,
  },
  {
    name: "interruption_resumption",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1 / 3,
  },
  {
    name: "session_persistence",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1 / 3,
  },
];

type ExecutionSummary = {
  savedCheckpoints: Checkpoint[];
  initialResult: Awaited<ReturnType<typeof run>>;
  interruptCheckpoint: Checkpoint;
  persistedAfterHasBlue: boolean;
  persistedAfterReopenCount: number;
  persistedBeforeHasBlue: boolean;
  persistedBeforeResumeCount: number;
  recallOutput: string;
  recallRuns: number;
  rememberRuns: number;
  resumedCheckpoint: Checkpoint;
  resumedMemoryLoads: Array<Extract<CanonicalAgentEvent, { type: "memory.load" }>>;
  resumedNodeStarts: Array<Extract<CanonicalAgentEvent, { type: "graph.node.start" }>>;
  resumedResult: Awaited<ReturnType<typeof resumeGraph>>;
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

function evaluateCheckpointEvents(summary: ExecutionSummary): MetricEvaluation {
  const checks = [
    summary.savedCheckpoints.length >= 2,
    summary.savedCheckpoints.every((checkpoint) => typeof checkpoint.id === "string"),
    summary.interruptCheckpoint.source === "interrupt",
    summary.interruptCheckpoint.nodeId === "pause",
    summary.savedCheckpoints.some((checkpoint) => checkpoint.id === summary.interruptCheckpoint.id),
  ];

  return {
    failureClass: "framework",
    note: `saved=${summary.savedCheckpoints.length}, interruptId=${summary.interruptCheckpoint.id}, interruptSource=${summary.interruptCheckpoint.source}, interruptNode=${summary.interruptCheckpoint.nodeId ?? "missing"}`,
    score: ratio(checks),
  };
}

function evaluateInterruptionResumption(summary: ExecutionSummary): MetricEvaluation {
  const resumedNodeIds = new Set(summary.resumedNodeStarts.map((event) => event.nodeId));
  const checks = [
    summary.initialResult.status === "Interrupted",
    summary.rememberRuns === 1,
    summary.recallRuns === 1,
    summary.interruptCheckpoint.pendingNodes.includes("pause"),
    summary.interruptCheckpoint.pendingNodes.includes("recall"),
    summary.resumedResult.status === "Complete",
    resumedNodeIds.has("pause"),
    resumedNodeIds.has("recall"),
    !resumedNodeIds.has("remember"),
  ];

  return {
    failureClass: "framework",
    note: `initial=${summary.initialResult.status}, resumed=${summary.resumedResult.status}, rememberRuns=${summary.rememberRuns}, recallRuns=${summary.recallRuns}, resumedNodes=${[...resumedNodeIds].join(",")}`,
    score: ratio(checks),
  };
}

function evaluateSessionPersistence(summary: ExecutionSummary): MetricEvaluation {
  const memoryLoadSeen = summary.resumedMemoryLoads.some(
    (event) => event.sessionId && event.sessionId.length > 0 && event.messageCount > 0
  );
  const recallMatches = /\bblue\b/i.test(summary.recallOutput);
  const frameworkChecks = [
    summary.persistedBeforeResumeCount > 0,
    summary.persistedBeforeHasBlue,
    summary.resumedCheckpoint.id === summary.interruptCheckpoint.id,
    summary.resumedCheckpoint.nodeResults["remember"]?.status === "completed",
    summary.persistedAfterReopenCount >= summary.persistedBeforeResumeCount,
    summary.persistedAfterHasBlue,
    memoryLoadSeen,
  ];

  return {
    failureClass: frameworkChecks.every(Boolean) && !recallMatches ? "provider" : "framework",
    note: `before=${summary.persistedBeforeResumeCount}, after=${summary.persistedAfterReopenCount}, beforeHasBlue=${summary.persistedBeforeHasBlue}, afterHasBlue=${summary.persistedAfterHasBlue}, memoryLoadSeen=${memoryLoadSeen}, recall=${JSON.stringify(summary.recallOutput)}`,
    score: ratio([...frameworkChecks, recallMatches]),
  };
}

export const checkpointResumeScenario: Scenario<BenchmarkContext> = {
  description: "Durable sqlite checkpoint resume across interruption and store reopen.",
  name: "checkpoint-resume",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(ctx) {
    let store: CheckpointBackend = ctx.checkpointStore;
    let provider: LLMProvider = await ctx.createBedrockProvider({ maxOutputTokens: 256 });
    let shouldInterrupt = true;
    let rememberRuns = 0;
    let recallRuns = 0;
    const streamSubject = createEventSubscribable();

    const rememberAgent = agent({
      name: "checkpoint-remember-benchmark",
      prompt:
        "You are a helpful assistant. Briefly confirm you will remember the user's stated preference for later in the same session.",
      streaming: true,
    });

    const recallAgent = agent({
      name: "checkpoint-recall-benchmark",
      prompt:
        "You are continuing the same conversation. Answer the user's question from prior session context. If the favorite color is known, answer with it briefly.",
      streaming: true,
    });

    const emitEvent = (event: unknown) => {
      streamSubject.emit(event);
    };

    try {
      const { result: summary } = await ctx.collectAgentEvents(streamSubject, async () => {
        const capturedCheckpoints: Checkpoint[] = [];

        const subject = graph({
          edges: [
            { from: "remember", to: "pause" },
            { from: "pause", to: "recall" },
          ],
          entry: "remember",
          nodes: [
            node("remember", async (input) => {
              rememberRuns += 1;
              return rememberAgent.run(String(input), provider, {
                checkpointStore: store,
                onEvent: emitEvent,
                sessionId: ctx.frameworkSessionId,
              });
            }),
            node("pause", async () => {
              if (shouldInterrupt) {
                interrupt({ reason: "checkpoint-resume-benchmark", requiresInput: true });
              }

              return "resume-accepted";
            }),
            node("recall", async () => {
              recallRuns += 1;
              return recallAgent.run(RECALL_INPUT, provider, {
                checkpointStore: store,
                onEvent: emitEvent,
                sessionId: ctx.frameworkSessionId,
              });
            }),
          ],
          onEvent: emitEvent,
          provider,
        });

        const initialResult = await run(subject, {
          checkpointStore: store,
          input: REMEMBER_INPUT,
          namespace: NAMESPACE,
          onCheckpoint: (checkpoint) => capturedCheckpoints.push(checkpoint),
          onEvent: emitEvent,
          sessionId: ctx.frameworkSessionId,
        });

        const savedCheckpoints = [...capturedCheckpoints];
        if (savedCheckpoints.length === 0) {
          throw new Error(
            `no checkpoints captured; event tail=${ctx
              .getEvents()
              .slice(-8)
              .map((event) => event.type)
              .join(",")}`
          );
        }
        const interruptCheckpoint = savedCheckpoints.find(
          (checkpoint) => checkpoint.source === "interrupt"
        );
        if (!interruptCheckpoint) {
          throw new Error(
            `missing interrupt checkpoint; checkpoints=${savedCheckpoints
              .map(
                (checkpoint) =>
                  `${checkpoint.source}:${checkpoint.step}:${checkpoint.nodeId ?? "-"}`
              )
              .join(",")}`
          );
        }

        const persistedBeforeResume = await store.getMessages(ctx.frameworkSessionId);
        await store.close();
        store = new SqliteCheckpointStore(ctx.checkpointDbPath);
        provider = await ctx.createBedrockProvider({ maxOutputTokens: 256 });

        const resumedCheckpoint = await store.getCheckpoint(interruptCheckpoint.id);
        if (!resumedCheckpoint) {
          throw new Error(`missing reopened checkpoint ${interruptCheckpoint.id}`);
        }

        const persistedAfterReopen = await store.getMessages(ctx.frameworkSessionId);
        shouldInterrupt = false;
        const resumeStartIndex = ctx.getEvents().length;
        const resumedResult = await resumeGraph(
          subject,
          resumedCheckpoint.id,
          store,
          undefined,
          emitEvent
        );
        const resumeEvents = ctx.getEvents().slice(resumeStartIndex);
        const resumedNodeStarts = resumeEvents.filter(
          (event): event is Extract<CanonicalAgentEvent, { type: "graph.node.start" }> =>
            event.type === "graph.node.start"
        );
        const resumedMemoryLoads = resumeEvents.filter(
          (event): event is Extract<CanonicalAgentEvent, { type: "memory.load" }> =>
            event.type === "memory.load"
        );
        const recallOutput = String(resumedResult.results["recall"]?.output ?? "");
        void capturedCheckpoints;

        return {
          savedCheckpoints,
          initialResult,
          interruptCheckpoint,
          persistedAfterHasBlue: persistedAfterReopen.some((message) =>
            message.content?.toLowerCase().includes("favorite color is blue")
          ),
          persistedAfterReopenCount: persistedAfterReopen.length,
          persistedBeforeHasBlue: persistedBeforeResume.some((message) =>
            message.content?.toLowerCase().includes("favorite color is blue")
          ),
          persistedBeforeResumeCount: persistedBeforeResume.length,
          recallOutput,
          recallRuns,
          rememberRuns,
          resumedCheckpoint,
          resumedMemoryLoads,
          resumedNodeStarts,
          resumedResult,
        } satisfies ExecutionSummary;
      });

      streamSubject.close();

      const evaluations = [
        evaluateCheckpointEvents(summary),
        evaluateInterruptionResumption(summary),
        evaluateSessionPersistence(summary),
      ];

      for (const [index, evaluation] of evaluations.entries()) {
        assertMetric(SCORING_CRITERIA[index]!, evaluation);
      }
    } finally {
      streamSubject.close();
      if (store !== ctx.checkpointStore) {
        await store.close();
      }
    }
  },
};
