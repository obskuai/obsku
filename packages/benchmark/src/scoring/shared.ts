import type { AgentEvent, CanonicalAgentEvent } from "@obsku/framework";
import { providerInstability } from "../runner";
import type { ScoringCriteria } from "../types";

export type MetricEvaluation = {
  failureClass: "framework" | "provider";
  note: string;
  score: number;
};

export function assertMetric(criteria: ScoringCriteria, evaluation: MetricEvaluation): void {
  const inRange =
    evaluation.score >= criteria.tolerance.min && evaluation.score <= criteria.tolerance.max;

  if (inRange) {
    return;
  }

  if (evaluation.failureClass === "provider") {
    throw providerInstability(`${criteria.name}: ${evaluation.note}`);
  }

  throw new Error(`${criteria.name}: ${evaluation.note}`);
}

export function isCanonicalEvent(event: AgentEvent): event is CanonicalAgentEvent {
  return typeof event.type === "string" && event.type.includes(".");
}
