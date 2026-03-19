import type { BenchmarkRun, RunSpec, Scenario, Suite, SuiteSummary } from "../types";
import type { BenchmarkContext } from "./context";

export interface SuiteState {
  abortReason?: SuiteSummary["abortReason"];
  finishedAt?: Date;
  lastScenarioEndedAt?: number;
  results: BenchmarkRun["scenarioResults"];
  runId: string;
  startedAt: Date;
  totalCostUsd: number;
}

export interface BenchmarkRunOptions<TCtx extends BenchmarkContext> {
  createContext?: (args: {
    baseContext: BenchmarkContext;
    scenario: Scenario<TCtx>;
    spec: RunSpec;
    suite: Suite<TCtx>;
  }) => Promise<TCtx> | TCtx;
  globalTimeoutMs?: number;
  maxRetries?: number;
  retryDelaysMs?: number[];
}
