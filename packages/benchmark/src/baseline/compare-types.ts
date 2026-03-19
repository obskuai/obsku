import type { BenchmarkRun, MetricResult, ScenarioResult, ScenarioStatus } from "../types";
import type { RunMetadata } from "../types/run";

export interface BaselineSnapshot {
  scenarioName: string;
  metrics: MetricResult[];
  compositeScore: number;
  modelId: string;
  timestamp: string;
  result: ScenarioResult;
}

export interface BaselineComparison {
  scenarioName: string;
  current: ScenarioResult;
  baseline: ScenarioResult | null;
  deltas: Record<string, number>;
  passed: boolean;
}

export interface ComparisonReportMetric {
  name: string;
  baselineScore: number | null;
  contenderScore: number | null;
  delta: number | null;
  baselinePassed: boolean | null;
  contenderPassed: boolean | null;
  baselineScorerVersion?: string;
  contenderScorerVersion?: string;
}

export interface ComparisonReportScenario {
  scenarioName: string;
  baselineScore: number | null;
  contenderScore: number | null;
  delta: number | null;
  baselineStatus: ScenarioStatus | null;
  contenderStatus: ScenarioStatus;
  baselineModelId: string | null;
  contenderModelId: string;
  baselineTimestamp: string | null;
  scenarioVersion: {
    baseline: string | null;
    contender: string | null;
  };
  versionMismatch: boolean;
  versionMismatchWarning: string | null;
  metrics: ComparisonReportMetric[];
  regressionSeverity: "none" | "warning" | "critical";
}

export interface ComparisonReport {
  baselineRunId: string | null;
  contenderRunId: string;
  timestamp: string;
  baselineMetadata: {
    runId: string | null;
    source: "scenario-baselines";
    scenarios: Array<{
      scenarioName: string;
      modelId: string;
      timestamp: string;
    }>;
  };
  contenderMetadata: {
    runId: string;
    modelId: string;
    startedAt: string;
    finishedAt: string;
    metadata?: RunMetadata;
  };
  scenarios: ComparisonReportScenario[];
}

export interface ComparisonReportInput {
  contenderRunId: string;
  contenderModelId: string;
  contenderStartedAt: string;
  contenderFinishedAt: string;
  contenderMetadata?: RunMetadata;
  scenarios: Array<{
    comparison: BaselineComparison;
    snapshot: BaselineSnapshot | null;
  }>;
}

export type { BenchmarkRun, MetricResult, ScenarioResult, ScenarioStatus };
