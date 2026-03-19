import {
  agent,
  type CanonicalAgentEvent,
  safeJsonParse,
  type ToolMiddleware,
  type ToolResultEvent,
} from "@obsku/framework";
import { z } from "zod";
import { type BenchmarkContext } from "../runner";
import { ratio } from "../scoring/scorer";
import { assertMetric, isCanonicalEvent, type MetricEvaluation } from "../scoring/shared";
import type { Scenario, ScoringCriteria } from "../types";

const INPUT =
  "Call echo with text 'hello', then call echo with text 'blocked', then call compute with x=5";

const SCORING_CRITERIA: ScoringCriteria[] = [
  {
    name: "middleware_execution_order",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 0.25,
  },
  { name: "short_circuit", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  { name: "result_rewrite", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 0.25 },
  {
    name: "tool_results_correct",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 0.25,
  },
];

type ParsedToolResult = {
  blocked?: boolean;
  echoed?: string;
  result?: number;
  audited?: boolean;
};

const echoToolDef = {
  description: "Echo deterministic text input.",
  name: "echo",
  params: z.object({ text: z.string() }),
  run: async (input: unknown) => ({
    echoed:
      typeof (input as { text?: unknown }).text === "string"
        ? ((input as { text: string }).text ?? "")
        : String((input as { text?: unknown }).text ?? ""),
  }),
};

const computeToolDef = {
  description: "Double a deterministic number.",
  name: "compute",
  params: z.object({ x: z.number() }),
  run: async (input: unknown) => ({
    result: Number((input as { x?: unknown }).x ?? 0) * 2,
  }),
};

function parseToolResult(result: unknown): ParsedToolResult {
  if (typeof result === "string") {
    const parsed = safeJsonParse(result);
    if (parsed.success && typeof parsed.data === "object" && parsed.data !== null) {
      return parsed.data as ParsedToolResult;
    }
  }

  if (typeof result === "object" && result !== null) {
    return result as ParsedToolResult;
  }

  return {};
}

function getToolResults(events: CanonicalAgentEvent[]): ToolResultEvent[] {
  return events.filter((event): event is ToolResultEvent => event.type === "tool.result");
}

function evaluateMiddlewareExecutionOrder(callLog: string[]): MetricEvaluation {
  const expectedOrder = ["echo", "echo", "compute"];
  const sawAllCalls = callLog.length >= expectedOrder.length;
  const inOrder = expectedOrder.every((toolName, index) => callLog[index] === toolName);

  return {
    failureClass: "framework",
    note: `callLog=${JSON.stringify(callLog)}`,
    score: ratio([sawAllCalls, inOrder]),
  };
}

function evaluateShortCircuit(events: CanonicalAgentEvent[]): MetricEvaluation {
  const echoResults = getToolResults(events)
    .filter((event) => event.toolName === "echo")
    .map((event) => parseToolResult(event.result));
  const blockedResult = echoResults.find((result) => result.blocked === true);
  const blockedEchoed = blockedResult?.echoed === "blocked";

  return {
    failureClass: blockedResult && !blockedEchoed ? "provider" : "framework",
    note: `echoResults=${JSON.stringify(echoResults)}`,
    score: ratio([blockedResult != null, !blockedEchoed]),
  };
}

function evaluateResultRewrite(events: CanonicalAgentEvent[]): MetricEvaluation {
  const computeResults = getToolResults(events)
    .filter((event) => event.toolName === "compute")
    .map((event) => parseToolResult(event.result));
  const auditedResult = computeResults.find((result) => result.audited === true);

  return {
    failureClass: auditedResult?.result === 10 ? "provider" : "framework",
    note: `computeResults=${JSON.stringify(computeResults)}`,
    score: ratio([auditedResult != null]),
  };
}

function evaluateToolResultsCorrect(events: CanonicalAgentEvent[]): MetricEvaluation {
  const toolResults = getToolResults(events);
  const echoHello = toolResults
    .filter((event) => event.toolName === "echo")
    .map((event) => parseToolResult(event.result))
    .find((result) => result.echoed === "hello");
  const compute = toolResults
    .filter((event) => event.toolName === "compute")
    .map((event) => parseToolResult(event.result))
    .find((result) => result.result === 10);

  return {
    failureClass: "provider",
    note: `echoHello=${JSON.stringify(echoHello)}, compute=${JSON.stringify(compute)}`,
    score: ratio([
      echoHello?.echoed === "hello",
      compute?.result === 10,
      compute?.audited === true,
    ]),
  };
}

export const toolMiddlewareScenario: Scenario<BenchmarkContext> = {
  description:
    "Tool middleware benchmark with global logging, short-circuiting, and result rewrite.",
  name: "tool-middleware",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(ctx) {
    const provider = await ctx.createBedrockProvider({ maxOutputTokens: 512 });
    const callLog: string[] = [];

    const loggingMiddleware: ToolMiddleware = async (toolCtx, next) => {
      callLog.push(toolCtx.toolName);
      return next();
    };

    const shortCircuitMiddleware: ToolMiddleware = async (toolCtx, next) => {
      if (
        toolCtx.toolName === "echo" &&
        typeof (toolCtx.toolInput as { text?: unknown }).text === "string" &&
        (toolCtx.toolInput as { text: string }).text === "blocked"
      ) {
        return { content: JSON.stringify({ blocked: true }) };
      }

      return next();
    };

    const resultRewriteMiddleware: ToolMiddleware = async (_toolCtx, next) => {
      const result = await next();
      const parsed = parseToolResult(result.content);
      return { content: JSON.stringify({ ...parsed, audited: true }) };
    };

    const subject = agent({
      name: "tool-middleware-benchmark",
      prompt:
        "You are a concise assistant. Execute the requested tools in order. Do not skip tools and do not invent results.",
      streaming: true,
      toolMiddleware: [loggingMiddleware],
      tools: [
        { tool: echoToolDef, middleware: [shortCircuitMiddleware] },
        { tool: computeToolDef, middleware: [resultRewriteMiddleware] },
      ],
    });

    const { events } = await ctx.collectAgentEvents(subject, (sessionId) =>
      subject.run(INPUT, provider, { sessionId })
    );

    if (!events.length || !events.every(isCanonicalEvent)) {
      throw new Error("tool-middleware emitted no canonical events");
    }

    const evaluations = [
      evaluateMiddlewareExecutionOrder(callLog),
      evaluateShortCircuit(events),
      evaluateResultRewrite(events),
      evaluateToolResultsCorrect(events),
    ];

    for (const [index, evaluation] of evaluations.entries()) {
      assertMetric(SCORING_CRITERIA[index]!, evaluation);
    }
  },
};
