import type { RunSpec, ToleranceConfig } from "./scenario";

/**
 * Classification of the failure root cause.
 * - `framework_regression` — the framework itself misbehaved (release-blocking).
 * - `provider_instability` — transient provider/network flake (not release-blocking).
 * - `unknown` — unclassified failure.
 */
export type ErrorClass = "framework_regression" | "provider_instability" | "unknown";

/**
 * Final outcome of a single scenario execution attempt.
 * - `pass`    — all assertions held.
 * - `fail`    — assertions failed (provider instability).
 * - `error`   — framework regression or unexpected error.
 * - `skipped` — execution skipped (budget exceeded, prior abort).
 */
export type ScenarioStatus = "pass" | "fail" | "error" | "skipped";

/**
 * Scoring result for one named metric within a scenario.
 */
export interface MetricResult {
  /** Metric name matching a `ScoringCriteria.name`. */
  name: string;
  /** Normalised score in [0, 1]. 1 = perfect. */
  score: number;
  /** The tolerance band that was applied. */
  toleranceBand: ToleranceConfig;
  /** Whether `score` falls within `toleranceBand`. */
  passed: boolean;
  /** Weight used when computing composite scenario score. */
  weight: number;
  /** Optional human-readable note explaining the score. */
  note?: string;
  /** Version of the scorer that produced this metric. */
  scorerVersion?: string;
}

/**
 * Token consumption and estimated cost for a single scenario execution.
 */
export interface ScenarioUsage {
  /** Total input tokens consumed. */
  inputTokens: number;
  /** Total output tokens generated. */
  outputTokens: number;
  /** Estimated cost in USD. May be an approximation. */
  estimatedCostUsd: number;
  /** Whether the cost is an estimate (true) or exact (false/undefined). */
  estimated?: boolean;
  /** Raw provider metadata for debugging (e.g. stop reason, latency). */
  providerMetadata?: Record<string, unknown>;
}

/**
 * Full result record for a single scenario execution.
 * Written to `result.json` in the scenario's artifact directory.
 */
export interface ScenarioResult {
  /** Stable scenario name, matches `Scenario.name`. */
  scenarioName: string;
  /** Scenario version for tracking changes over time. */
  scenarioVersion?: string;
  /** Model that executed the scenario. */
  modelId: string;
  /** Final outcome status. */
  status: ScenarioStatus;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Number of retry attempts before the final status was reached. */
  retries: number;
  /** Token usage and estimated cost. Present when execution started. */
  usage?: ScenarioUsage;
  /** Metric scores. Present when scenario defines `scoringCriteria`. */
  metrics?: MetricResult[];
  /**
   * Composite score in [0, 1]: weighted average of all metric scores.
   * Absent when no scoring criteria are defined.
   */
  compositeScore?: number;
  /** Error classification when `status` is "fail" or "error". */
  errorClass?: ErrorClass;
  /** Error message string. */
  errorMessage?: string;
  /** Error stack trace. */
  errorStack?: string;
}

/**
 * Git provenance and runtime environment captured at suite start.
 * Embedded in SuiteSummary for reproducibility tracking.
 */
export interface RunMetadata {
  /** Git provenance at run start. */
  git: {
    /** Full SHA-1 commit hash. Empty string when git is unavailable. */
    commit: string;
    /** Current branch name. Empty string when detached or unavailable. */
    branch: string;
    /** true when the working tree has uncommitted changes. */
    dirty: boolean;
  };
  /** Runtime environment at run start. */
  env: {
    /** Runtime name — "bun" or "node". */
    runtime: string;
    /** Runtime version string (e.g. "1.2.3" for Bun, "v22.0.0" for Node). */
    runtimeVersion: string;
    /** process.platform value (e.g. "linux", "darwin", "win32"). */
    platform: string;
  };
  /** ISO 8601 timestamp when the suite started. */
  startTime: string;
  /** ISO 8601 timestamp when the suite finished. */
  endTime: string;
}

/**
 * Aggregated summary for an entire suite run.
 * Written to `suite-summary.json` in the run artifact directory.
 */
export interface SuiteSummary {
  /** Unique run identifier, e.g. "bench-20260315-suite-1710512400000". */
  runId: string;
  /** ISO 8601 timestamp when the suite started. */
  startedAt: string;
  /** ISO 8601 timestamp when the suite finished. */
  finishedAt: string;
  /** Total number of scenarios registered in the suite. */
  totalScenarios: number;
  /** Count of scenarios with status "pass". */
  passed: number;
  /** Count of scenarios with status "fail" or "error". */
  failed: number;
  /** Count of scenarios attributed to provider_instability. */
  providerInstability: number;
  /** Count of scenarios that were skipped. */
  skipped: number;
  /** Sum of all scenario `estimatedCostUsd`. */
  totalCostUsd: number;
  /**
   * Weighted average composite score across all scored scenarios.
   * Absent when no scoring criteria were defined.
   */
  avgCompositeScore?: number;
  /** Set when the suite was aborted early. */
  abortReason?: "budget_exceeded" | "wall_clock_exceeded";
  /**
   * Git provenance and runtime environment collected at suite start.
   * Absent when metadata collection fails (e.g. no git repository).
   */
  metadata?: RunMetadata;
}

/**
 * Top-level record representing a complete benchmark execution.
 * Combines the specification, per-scenario results, and suite summary.
 */
export interface BenchmarkRun {
  /** Unique run identifier matching `SuiteSummary.runId`. */
  runId: string;
  /** Name of the suite that was executed. */
  suiteName: string;
  /** The configuration spec used for this run. */
  spec: RunSpec;
  /** Per-scenario execution results in execution order. */
  scenarioResults: ScenarioResult[];
  /** Aggregated suite summary. */
  summary: SuiteSummary;
  /** Absolute path to the artifact directory for this run. */
  artifactsPath: string;
  /** ISO 8601 timestamp when the run started. */
  startedAt: string;
  /** ISO 8601 timestamp when the run finished. */
  finishedAt: string;
}
