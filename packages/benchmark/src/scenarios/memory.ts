import { type BenchmarkContext } from "../runner";
import type { Scenario, ScoringCriteria } from "../types";

const SCORING_CRITERIA: ScoringCriteria[] = [
  { name: "memory_retention", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 1.0 },
];

export const memoryScenario: Scenario<BenchmarkContext> = {
  description: "Memory retention and recall benchmark.",
  name: "memory",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(_ctx) {
    throw new Error("not implemented");
  },
};
