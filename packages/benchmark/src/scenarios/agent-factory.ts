import {
  agent,
  type CanonicalAgentEvent,
  type InternalPlugin,
  safeJsonParse,
  type ToolCallEvent,
  type ToolResultEvent,
} from "@obsku/framework";
import { Effect } from "effect";
import { type BenchmarkContext } from "../runner";
import { assertMetric, isCanonicalEvent, MetricEvaluation } from "../scoring/shared";
import type { Scenario, ScoringCriteria } from "../types";

const INPUT =
  "Use get_data to fetch items, then create a specialist agent to count and list them in uppercase.";

const SCORING_CRITERIA: ScoringCriteria[] = [
  {
    name: "factory_invocation",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1 / 3,
  },
  {
    name: "sub_agent_execution",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1 / 3,
  },
  { name: "output_content", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 1 / 3 },
];

const getDataTool: InternalPlugin = {
  description: "Return deterministic benchmark items.",
  execute: () =>
    Effect.succeed({
      items: ["alpha", "beta", "gamma"],
    }),
  name: "get_data",
  params: {},
};

function isExecuteAgentToolName(toolName: string): boolean {
  return toolName === "execute_agent" || toolName.includes("execute_agent");
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

function getToolCalls(events: CanonicalAgentEvent[]): ToolCallEvent[] {
  return events.filter((event): event is ToolCallEvent => event.type === "tool.call");
}

function getToolResults(events: CanonicalAgentEvent[]): ToolResultEvent[] {
  return events.filter((event): event is ToolResultEvent => event.type === "tool.result");
}

function hasEmbeddedError(result: unknown): boolean {
  if (typeof result !== "string") {
    return typeof result === "object" && result !== null && "error" in result;
  }

  const parsed = safeJsonParse<Record<string, unknown>>(result);
  return (
    parsed.success &&
    typeof parsed.data === "object" &&
    parsed.data !== null &&
    "error" in parsed.data
  );
}

function evaluateFactoryInvocation(events: CanonicalAgentEvent[]): MetricEvaluation {
  const executeAgentCalls = getToolCalls(events).filter((event) =>
    isExecuteAgentToolName(event.toolName)
  );

  return {
    failureClass: "provider",
    note: `executeAgentCalls=${executeAgentCalls.length}`,
    score: executeAgentCalls.length > 0 ? 1 : 0,
  };
}

function evaluateSubAgentExecution(events: CanonicalAgentEvent[]): MetricEvaluation {
  const executeAgentCalls = getToolCalls(events).filter((event) =>
    isExecuteAgentToolName(event.toolName)
  );
  const executeAgentResults = getToolResults(events).filter((event) =>
    isExecuteAgentToolName(event.toolName)
  );
  const pairedResult = executeAgentCalls
    .map((call) => executeAgentResults.find((result) => result.toolUseId === call.toolUseId))
    .find((result): result is ToolResultEvent => result !== undefined);
  const nonErrorResult =
    pairedResult !== undefined && !pairedResult.isError && !hasEmbeddedError(pairedResult.result);

  return {
    failureClass: pairedResult ? "provider" : "framework",
    note:
      `executeAgentCalls=${executeAgentCalls.length}, executeAgentResults=${executeAgentResults.length}, ` +
      `paired=${pairedResult != null}, toolError=${pairedResult?.isError ?? false}, result=${stringifyValue(pairedResult?.result)}`,
    score: nonErrorResult ? 1 : 0,
  };
}

function evaluateOutputContent(output: string): MetricEvaluation {
  const normalized = output.toLowerCase();
  const hasAlpha = normalized.includes("alpha") || normalized.includes("ALPHA".toLowerCase());
  const hasBeta = normalized.includes("beta") || normalized.includes("BETA".toLowerCase());
  const hasGamma = normalized.includes("gamma") || normalized.includes("GAMMA".toLowerCase());
  const hasAllItems = hasAlpha && hasBeta && hasGamma;
  const hasCount = /\b3\b|\bthree\b/i.test(output);

  return {
    failureClass: "provider",
    note:
      `hasAlpha=${hasAlpha}, hasBeta=${hasBeta}, hasGamma=${hasGamma}, ` +
      `hasCount=${hasCount}, output=${JSON.stringify(output)}`,
    score: hasAllItems || hasCount ? 1 : 0,
  };
}

export const agentFactoryScenario: Scenario<BenchmarkContext> = {
  description: "Parent agent uses execute_agent to delegate deterministic item summarization.",
  name: "agent-factory",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(ctx) {
    const provider = await ctx.createBedrockProvider({ maxOutputTokens: 512 });

    const subject = agent({
      agentFactory: { maxAgents: 3, maxDepth: 2 },
      name: "agent-factory-benchmark",
      prompt:
        "You are a parent agent. First call get_data. Then call execute_agent exactly once to create a specialist agent that counts the items and lists them in uppercase. Pass the fetched items into the delegated task. After execute_agent returns, answer briefly with the count and the items. Do not use create_agent or call_agent.",
      streaming: true,
      tools: [getDataTool],
    });

    const { events, result: finalOutput } = await ctx.collectAgentEvents(subject, (sessionId) =>
      subject.run(INPUT, provider, { sessionId })
    );

    if (!events.length || !events.every(isCanonicalEvent)) {
      throw new Error("agent-factory emitted no canonical events");
    }

    const evaluations = [
      evaluateFactoryInvocation(events),
      evaluateSubAgentExecution(events),
      evaluateOutputContent(finalOutput),
    ];

    for (const [index, evaluation] of evaluations.entries()) {
      assertMetric(SCORING_CRITERIA[index]!, evaluation);
    }
  },
};
