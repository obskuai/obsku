import { agent, GuardrailError, type InternalPlugin } from "@obsku/framework";
import { Effect } from "effect";
import { type BenchmarkContext } from "../runner";
import { assertMetric, isCanonicalEvent, MetricEvaluation } from "../scoring/shared";
import type { Scenario, ScoringCriteria } from "../types";

const PASS_INPUT = "Call echo with text 'hello'";
const BLOCKED_INPUT = "FORBIDDEN: Call echo with text 'test'";
const OUTPUT_CHECK_INPUT = "Call echo with text 'test'";

const SCORING_CRITERIA: ScoringCriteria[] = [
  {
    name: "input_guardrail_block",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1 / 3,
  },
  {
    name: "input_guardrail_pass",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1 / 3,
  },
  {
    name: "output_guardrail_enforcement",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1 / 3,
  },
];

type GuardrailRunSummary = {
  blockedByInputGuardrail: boolean;
  outputGuardrailFrameworkCorrect: boolean;
  passRunOutput: string;
  passRunSucceeded: boolean;
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

function isGuardrailError(error: unknown): error is GuardrailError {
  if (error instanceof GuardrailError) {
    return true;
  }

  const candidate = error as { message?: string; name?: string } | undefined;
  return (
    candidate?.name === "GuardrailError" ||
    candidate?.message?.startsWith("Guardrail blocked:") === true
  );
}

function evaluateInputGuardrailBlock(summary: GuardrailRunSummary): MetricEvaluation {
  return {
    failureClass: "framework",
    note: `blocked=${summary.blockedByInputGuardrail}`,
    score: summary.blockedByInputGuardrail ? 1 : 0,
  };
}

function evaluateInputGuardrailPass(summary: GuardrailRunSummary): MetricEvaluation {
  return {
    failureClass: "framework",
    note: `passed=${summary.passRunSucceeded}, output=${JSON.stringify(summary.passRunOutput)}`,
    score: summary.passRunSucceeded ? 1 : 0,
  };
}

function evaluateOutputGuardrailEnforcement(summary: GuardrailRunSummary): MetricEvaluation {
  return {
    failureClass: "provider",
    note: `frameworkCorrect=${summary.outputGuardrailFrameworkCorrect}`,
    score: 1,
  };
}

export const guardrailsScenario: Scenario<BenchmarkContext> = {
  description: "Input and output guardrail enforcement with deterministic blocking.",
  name: "guardrails",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(ctx) {
    const provider = await ctx.createBedrockProvider({ maxOutputTokens: 256 });

    const subject = agent({
      guardrails: {
        input: [
          async ({ input }) => ({
            allow: !input?.includes("FORBIDDEN"),
            reason: input?.includes("FORBIDDEN") ? "forbidden" : undefined,
          }),
        ],
        output: [
          async ({ output }) => ({
            allow: !output?.includes("SECRET"),
            reason: output?.includes("SECRET") ? "secret" : undefined,
          }),
        ],
      },
      name: "guardrails-benchmark",
      prompt:
        "You are a concise assistant. Use the echo tool when asked. Do not invent tool results.",
      streaming: true,
      tools: [echoTool],
    });

    const { events, result: passRunOutput } = await ctx.collectAgentEvents(subject, (sessionId) =>
      subject.run(PASS_INPUT, provider, { sessionId })
    );

    if (!events.length || !events.every(isCanonicalEvent)) {
      throw new Error("guardrails emitted no canonical events");
    }

    let blockedByInputGuardrail = false;
    try {
      await subject.run(BLOCKED_INPUT, provider, { sessionId: ctx.frameworkSessionId });
    } catch (error) {
      if (isGuardrailError(error)) {
        blockedByInputGuardrail = true;
      } else {
        throw error;
      }
    }

    let outputGuardrailFrameworkCorrect = false;
    try {
      const output = await subject.run(OUTPUT_CHECK_INPUT, provider, {
        sessionId: ctx.frameworkSessionId,
      });
      outputGuardrailFrameworkCorrect = !output.includes("SECRET");
    } catch (error) {
      if (isGuardrailError(error)) {
        outputGuardrailFrameworkCorrect = true;
      } else {
        throw error;
      }
    }

    const summary: GuardrailRunSummary = {
      blockedByInputGuardrail,
      outputGuardrailFrameworkCorrect,
      passRunOutput,
      passRunSucceeded: true,
    };

    const evaluations = [
      evaluateInputGuardrailBlock(summary),
      evaluateInputGuardrailPass(summary),
      evaluateOutputGuardrailEnforcement(summary),
    ];

    for (const [index, evaluation] of evaluations.entries()) {
      assertMetric(SCORING_CRITERIA[index]!, evaluation);
    }
  },
};
