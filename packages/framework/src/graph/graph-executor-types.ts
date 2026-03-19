import type { AgentEvent } from "../types";
import type { ExecuteGraphOptions, Graph, NodeResult } from "./types";

export interface ExecutionContext {
  depth: number;
  graph: Graph;

  onEvent?: (event: AgentEvent) => void;
  options?: ExecuteGraphOptions;
  results: Map<string, NodeResult>;
}

export type InterruptedPhaseResult = { nodeId: string; status: "Interrupted" };

export type ExecutionPhaseResult =
  | { status: "Complete" }
  | { status: "Failed" }
  | InterruptedPhaseResult;
