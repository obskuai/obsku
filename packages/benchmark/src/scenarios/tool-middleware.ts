import { type BenchmarkContext } from "../runner";
import type { Scenario, ScoringCriteria } from "../types";

const SCORING_CRITERIA: ScoringCriteria[] = [
  {
    name: "middleware_execution",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1.0,
  },
];

export const toolMiddlewareScenario: Scenario<BenchmarkContext> = {
  description: "Tool middleware execution benchmark.",
  name: "tool-middleware",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(_ctx) {
    throw new Error("not implemented");
  },
};
