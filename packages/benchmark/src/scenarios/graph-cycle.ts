import { type BenchmarkContext } from "../runner";
import type { Scenario, ScoringCriteria } from "../types";

const SCORING_CRITERIA: ScoringCriteria[] = [
  { name: "cycle_handling", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 1.0 },
];

export const graphCycleScenario: Scenario<BenchmarkContext> = {
  description: "Graph cycle handling benchmark.",
  name: "graph-cycle",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(_ctx) {
    throw new Error("not implemented");
  },
};
