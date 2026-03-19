import type { GraphFailureEnvelope } from "../types";

export interface CompleteNodeExecutionOutcome {
  readonly kind: "complete";
  readonly output: unknown;
}

export interface FailedNodeExecutionOutcome {
  readonly kind: "failed";
  readonly output: GraphFailureEnvelope;
}

export type NodeExecutionOutcome = CompleteNodeExecutionOutcome | FailedNodeExecutionOutcome;

export function completeNodeExecution(output: unknown): CompleteNodeExecutionOutcome {
  return { kind: "complete", output };
}

export function failedNodeExecution(output: GraphFailureEnvelope): FailedNodeExecutionOutcome {
  return { kind: "failed", output };
}
