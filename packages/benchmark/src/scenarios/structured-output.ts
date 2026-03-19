import { StructuredOutputError, structuredAgent } from "@obsku/framework";
import { z } from "zod";
import { type BenchmarkContext } from "../runner";
import { ratio } from "../scoring/scorer";
import { assertMetric, type MetricEvaluation } from "../scoring/shared";
import type { Scenario, ScoringCriteria } from "../types";

const INPUT =
  "Rate the programming language TypeScript. Give it a name, a score 0-100, and relevant tags.";

const outputSchema = z.object({
  name: z.string(),
  score: z.number().min(0).max(100),
  tags: z.array(z.string()),
});

type StructuredOutput = z.infer<typeof outputSchema>;

const SCORING_CRITERIA: ScoringCriteria[] = [
  {
    name: "schema_conformance",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1 / 3,
  },
  {
    name: "field_completeness",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1 / 3,
  },
  { name: "output_quality", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 1 / 3 },
];

function tryParseObject(text: string | null): Record<string, unknown> | null {
  if (!text) {
    return null;
  }

  const candidates = [
    text.trim(),
    text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    (() => {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      return start >= 0 && end > start ? text.slice(start, end + 1).trim() : null;
    })(),
  ].filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function evaluateSchemaConformance(parseError: StructuredOutputError | null): MetricEvaluation {
  return {
    failureClass: "provider",
    note: parseError
      ? `structured validation failed: ${parseError.validationErrors.join("; ")}`
      : "structured output parsed successfully",
    score: parseError ? 0 : 1,
  };
}

function evaluateFieldCompleteness(
  value: StructuredOutput | null,
  raw: string | null
): MetricEvaluation {
  const candidate = value ?? tryParseObject(raw);
  const hasName = typeof candidate?.name === "string";
  const hasScore = typeof candidate?.score === "number" && Number.isFinite(candidate.score);
  const hasTags =
    Array.isArray(candidate?.tags) && candidate.tags.every((tag) => typeof tag === "string");

  return {
    failureClass: "provider",
    note: `name=${hasName}, score=${hasScore}, tags=${hasTags}`,
    score: ratio([hasName, hasScore, hasTags]),
  };
}

function evaluateOutputQuality(
  value: StructuredOutput | null,
  raw: string | null
): MetricEvaluation {
  const candidate = value ?? tryParseObject(raw);
  const nameMatches = typeof candidate?.name === "string" && /typescript/i.test(candidate.name);
  const scoreValid =
    typeof candidate?.score === "number" &&
    Number.isFinite(candidate.score) &&
    candidate.score >= 0 &&
    candidate.score <= 100;
  const hasTags = Array.isArray(candidate?.tags) && candidate.tags.length >= 1;

  return {
    failureClass: "provider",
    note: `nameMatches=${nameMatches}, scoreValid=${scoreValid}, hasTags=${hasTags}`,
    score: ratio([nameMatches, scoreValid, hasTags]),
  };
}

export const structuredOutputScenario: Scenario<BenchmarkContext> = {
  description: "Structured output benchmark with schema validation and deterministic scoring.",
  name: "structured-output",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(ctx) {
    const provider = await ctx.createBedrockProvider({ maxOutputTokens: 256 });
    const subject = structuredAgent({
      maxRetries: 2,
      name: "structured-output-benchmark",
      output: outputSchema,
      prompt: "You are a helpful assistant that rates programming languages.",
    });

    let value: StructuredOutput | null = null;
    let parseError: StructuredOutputError | null = null;

    try {
      value = await subject.run(INPUT, provider);
    } catch (error) {
      if (error instanceof StructuredOutputError) {
        parseError = error;
      } else {
        throw error;
      }
    }

    const raw = value ? JSON.stringify(value) : (parseError?.receivedText ?? null);
    const evaluations = [
      evaluateSchemaConformance(parseError),
      evaluateFieldCompleteness(value, raw),
      evaluateOutputQuality(value, raw),
    ];

    for (const [index, evaluation] of evaluations.entries()) {
      assertMetric(SCORING_CRITERIA[index]!, evaluation);
    }
  },
};
