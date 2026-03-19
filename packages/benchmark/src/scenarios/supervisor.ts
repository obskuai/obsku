import {
  type AgentDef,
  type CanonicalAgentEvent,
  type InternalPlugin,
  run,
  supervisor,
  type ToolCallEvent,
  type ToolResultEvent,
} from "@obsku/framework";
import { Effect } from "effect";
import { type BenchmarkContext, type EventSubscribable } from "../runner";
import { ratio } from "../scoring/scorer";
import { assertMetric, isCanonicalEvent, MetricEvaluation } from "../scoring/shared";
import type { Scenario, ScoringCriteria } from "../types";

const INPUT = "First compute 3+4, then reverse the word 'hello'";
const SUPERVISOR_NAME = "supervisor-benchmark";

const SCORING_CRITERIA: ScoringCriteria[] = [
  {
    name: "routing_correctness",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 0.25,
  },
  { name: "worker_execution", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  { name: "finish_signal", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  { name: "output_content", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
];

const addTool: InternalPlugin = {
  description: "Add two numbers deterministically.",
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

const multiplyTool: InternalPlugin = {
  description: "Multiply two numbers deterministically.",
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

const reverseTool: InternalPlugin = {
  description: "Reverse a string deterministically.",
  execute: (input) =>
    Effect.succeed({
      reversed: String(input.text ?? "")
        .split("")
        .reverse()
        .join(""),
    }),
  name: "reverse",
  params: {
    text: { required: true, type: "string" },
  },
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

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getToolCalls(events: CanonicalAgentEvent[]): ToolCallEvent[] {
  return events.filter((event): event is ToolCallEvent => event.type === "tool.call");
}

function getToolResults(events: CanonicalAgentEvent[]): ToolResultEvent[] {
  return events.filter((event): event is ToolResultEvent => event.type === "tool.result");
}

function evaluateRoutingCorrectness(events: CanonicalAgentEvent[]): MetricEvaluation {
  const routes = events.filter(
    (event): event is Extract<CanonicalAgentEvent, { type: "supervisor.routing" }> =>
      event.type === "supervisor.routing"
  );
  const sawMathWorker = routes.some((event) => event.next === "math-worker");
  const sawTextWorker = routes.some((event) => event.next === "text-worker");
  const routingFailed = events.some((event) => event.type === "supervisor.routing.failed");

  return {
    failureClass: routes.length > 0 && !routingFailed ? "provider" : "framework",
    note: `routes=${routes.map((event) => event.next).join(",") || "none"}, routingFailed=${routingFailed}`,
    score: ratio([sawMathWorker, sawTextWorker, !routingFailed]),
  };
}

function evaluateWorkerExecution(events: CanonicalAgentEvent[]): MetricEvaluation {
  const calls = getToolCalls(events);
  const results = getToolResults(events);
  const addCall = calls.find(
    (event) => event.toolName === "add" && event.args.a === 3 && event.args.b === 4
  );
  const reverseCall = calls.find(
    (event) => event.toolName === "reverse" && event.args.text === "hello"
  );
  const addResult = results.find(
    (event) => event.toolName === "add" && stringifyValue(event.result).includes("7")
  );
  const reverseResult = results.find(
    (event) => event.toolName === "reverse" && stringifyValue(event.result).includes("olleh")
  );
  const addPaired =
    addCall != null &&
    results.filter((event) => event.toolUseId === addCall.toolUseId).length === 1;
  const reversePaired =
    reverseCall != null &&
    results.filter((event) => event.toolUseId === reverseCall.toolUseId).length === 1;

  return {
    failureClass: addPaired && reversePaired ? "provider" : "framework",
    note:
      `addCall=${addCall != null}, reverseCall=${reverseCall != null}, ` +
      `addResult=${addResult != null}, reverseResult=${reverseResult != null}, ` +
      `addPaired=${addPaired}, reversePaired=${reversePaired}`,
    score: ratio([
      addCall != null,
      reverseCall != null,
      addResult != null,
      reverseResult != null,
      addPaired,
      reversePaired,
    ]),
  };
}

function evaluateFinishSignal(
  events: CanonicalAgentEvent[],
  result: Awaited<ReturnType<typeof run>>
): MetricEvaluation {
  const finishRouteIndex = getEventIndex(
    events,
    (event) => event.type === "supervisor.routing" && event.next === "FINISH"
  );
  const finishEventIndex = getEventIndex(events, (event) => event.type === "supervisor.finish");
  const addCallIndex = getEventIndex(
    events,
    (event) => event.type === "tool.call" && event.toolName === "add"
  );
  const reverseCallIndex = getEventIndex(
    events,
    (event) => event.type === "tool.call" && event.toolName === "reverse"
  );
  const finishAfterWorkers =
    finishRouteIndex > addCallIndex &&
    finishRouteIndex > reverseCallIndex &&
    finishEventIndex > finishRouteIndex;

  return {
    failureClass:
      result.status === "Complete" && addCallIndex > -1 && reverseCallIndex > -1
        ? "provider"
        : "framework",
    note:
      `status=${result.status}, finishRouteIndex=${finishRouteIndex}, finishEventIndex=${finishEventIndex}, ` +
      `addCallIndex=${addCallIndex}, reverseCallIndex=${reverseCallIndex}`,
    score: ratio([
      result.status === "Complete",
      finishRouteIndex > -1,
      finishEventIndex > -1,
      finishAfterWorkers,
    ]),
  };
}

function getFinalOutput(result: Awaited<ReturnType<typeof run>>): string {
  if (result.status !== "Complete") {
    return "";
  }

  const nodeResult = result.results[SUPERVISOR_NAME];
  if (!nodeResult || nodeResult.status !== "Complete" || !isRecord(nodeResult.output)) {
    return "";
  }

  const output = nodeResult.output;
  const workerResults = isRecord(output.results) ? output.results : {};

  return [
    stringifyValue(workerResults["math-worker"]),
    stringifyValue(workerResults["text-worker"]),
    stringifyValue(output),
  ].join(" ");
}

function evaluateOutputContent(finalOutput: string): MetricEvaluation {
  const hasSum = /\b7\b/.test(finalOutput);
  const hasReverse = /olleh/i.test(finalOutput);

  return {
    failureClass: "provider",
    note: `hasSum=${hasSum}, hasReverse=${hasReverse}, output=${JSON.stringify(finalOutput)}`,
    score: ratio([hasSum, hasReverse]),
  };
}

export const supervisorScenario: Scenario<BenchmarkContext> = {
  description: "Supervisor multi-agent routing with deterministic math and text workers.",
  name: "supervisor",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(ctx) {
    const provider = await ctx.createBedrockProvider({ maxOutputTokens: 512 });
    const streamSubject = createEventSubscribable();

    const mathWorker: AgentDef = {
      maxIterations: 3,
      name: "math-worker",
      prompt:
        "You are math-worker. Use the add tool exactly once with a=3 and b=4. Do not use multiply unless the user explicitly asks for multiplication. After the tool result, answer exactly: math result: 7",
      streaming: true,
      tools: [addTool, multiplyTool],
    };

    const textWorker: AgentDef = {
      maxIterations: 3,
      name: "text-worker",
      prompt:
        "You are text-worker. Use the reverse tool exactly once with text='hello'. Do not use echo unless the user explicitly asks to echo text. After the tool result, answer exactly: text result: olleh",
      streaming: true,
      tools: [echoTool, reverseTool],
    };

    const emitEvent = (event: unknown) => {
      streamSubject.emit(event);
    };

    const subject = supervisor({
      maxRounds: 5,
      name: SUPERVISOR_NAME,
      onEvent: emitEvent,
      prompt: `You are a supervisor coordinating two workers.

Route strictly by progress:
- If no worker result exists yet, respond with {"next":"math-worker"}.
- After the math worker has produced its result and the text worker has not, respond with {"next":"text-worker"}.
- After both worker results exist, respond with {"next":"FINISH"}.

Never skip a required worker. Respond with JSON only.`,
      provider,
      workers: [mathWorker, textWorker],
    });

    try {
      const { events, result } = await ctx.collectAgentEvents(streamSubject, (sessionId) =>
        run(subject, {
          input: INPUT,
          onEvent: emitEvent,
          sessionId,
        })
      );

      if (!events.length || !events.every(isCanonicalEvent)) {
        throw new Error("supervisor emitted no canonical events");
      }

      const finalOutput = getFinalOutput(result);
      const evaluations = [
        evaluateRoutingCorrectness(events),
        evaluateWorkerExecution(events),
        evaluateFinishSignal(events, result),
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
