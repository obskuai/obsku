import { type BenchmarkContext } from "../runner";
import type { Scenario, ScoringCriteria } from "../types";

const SCORING_CRITERIA: ScoringCriteria[] = [
  {
    name: "supervisor_coordination",
    scorerVersion: "1.0.0",
    tolerance: { min: 1, max: 1 },
    weight: 1.0,
  },
];

export const supervisorScenario: Scenario<BenchmarkContext> = {
  description: "Supervisor multi-agent coordination benchmark.",
  name: "supervisor",
  version: "1.0.0",
  scoringCriteria: SCORING_CRITERIA,
  async run(_ctx) {
    throw new Error("not implemented");
  },
};
