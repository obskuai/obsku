import { type BenchmarkContext } from "../runner";
import type { Scenario, ScoringCriteria } from "../types";

const SCORING_CRITERIA: ScoringCriteria[] = [
  {
    name: "guardrail_enforcement",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1.0,
  },
];

export const guardrailsScenario: Scenario<BenchmarkContext> = {
  description: "Guardrail enforcement benchmark.",
  name: "guardrails",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(_ctx) {
    throw new Error("not implemented");
  },
};
