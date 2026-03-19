import { type BenchmarkContext } from "../runner";
import type { Scenario, ScoringCriteria } from "../types";

const SCORING_CRITERIA: ScoringCriteria[] = [
  { name: "factory_creation", scorerVersion: "1.0.0", tolerance: { min: 1, max: 1 }, weight: 1.0 },
];

export const agentFactoryScenario: Scenario<BenchmarkContext> = {
  description: "Agent factory creation benchmark.",
  name: "agent-factory",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(_ctx) {
    throw new Error("not implemented");
  },
};
