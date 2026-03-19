/**
 * Acceptable score range for a metric.
 * Scores within [min, max] are considered passing.
 */
export interface ToleranceConfig {
  /** Minimum acceptable score (inclusive, 0–1). Default 0. */
  min: number;
  /** Maximum acceptable score (inclusive, 0–1). Default 1. */
  max: number;
}

/**
 * A named metric with its weight and tolerance band.
 * Used to drive deterministic scoring inside a Scenario.
 */
export interface ScoringCriteria {
  /** Unique metric name (e.g. "tool_pairing", "turn_lifecycle"). */
  name: string;
  /** Version of the scorer logic backing this criterion. */
  scorerVersion?: string;
  /** Relative weight when computing a composite score (0–1, sum across criteria should be 1). */
  weight: number;
  /** Acceptable score range — defaults to { min: 1, max: 1 } (exact pass). */
  tolerance: ToleranceConfig;
}

/**
 * A single benchmark scenario: a named, runnable unit with scoring criteria.
 *
 * @typeParam TCtx — The runtime context the runner provides when invoking `run`.
 *   Defaults to `unknown` so callers can narrow via their own runner context type.
 */
export interface Scenario<TCtx = unknown> {
  /** Unique stable identifier used in artifact paths and reports. */
  name: string;
  /** Human-readable description shown in reports and logs. */
  description?: string;
  /** Scenario version for tracking changes over time. */
  version: string;
  /**
   * The scenario body. The runner injects `ctx` at execution time.
   * Should throw on assertion failure; the runner classifies the error.
   */
  run: (ctx: TCtx) => Promise<void>;
  /**
   * Scoring criteria evaluated after a successful run.
   * If omitted, the scenario is pass/fail only (no metric scoring).
   */
  scoringCriteria?: ScoringCriteria[];
  /** Per-scenario timeout override in ms. Overrides RunSpec.timeoutMs if set. */
  timeoutMs?: number;
}

/** Suite-level configuration shared across all scenarios in the suite. */
export interface SuiteConfig {
  /** Default per-scenario timeout in ms. Falls back to RunSpec.timeoutMs. */
  timeoutMs?: number;
  /** Number of consecutive failures before aborting the suite. Default: unlimited. */
  maxConsecutiveFailures?: number;
  /** Delay between scenario executions in ms (rate-limiting). */
  interScenarioDelayMs?: number;
}

/**
 * A named collection of scenarios that run together as a benchmark suite.
 *
 * @typeParam TCtx — Context type forwarded to each Scenario.run.
 */
export interface Suite<TCtx = unknown> {
  /** Unique identifier for this suite. Used in run IDs and artifact paths. */
  name: string;
  /** Human-readable description. */
  description?: string;
  /** Ordered list of scenarios to execute. */
  scenarios: Array<Scenario<TCtx>>;
  /** Suite-level configuration. */
  config?: SuiteConfig;
}

/**
 * Full configuration for a benchmark run: model, limits, and behavior.
 */
export interface RunSpec {
  /** AWS Bedrock (or other provider) model identifier. */
  modelId: string;
  /** AWS region for provider calls. Defaults to "us-east-1". */
  region?: string;
  /**
   * Default per-scenario wall-clock timeout in ms.
   * Scenarios may override via `Scenario.timeoutMs`.
   */
  timeoutMs: number;
  /** Maximum total spend allowed for the run in USD. Aborts on breach. */
  budgetUsd: number;
  /**
   * Global tolerance config applied when a scenario's ScoringCriteria
   * does not specify its own tolerance.
   */
  defaultTolerance?: ToleranceConfig;
  /** Root directory for artifact output. Defaults to ".benchmark-runs". */
  artifactBaseDir?: string;
  /**
   * Prefix for run IDs and session identifiers.
   * Defaults to "bench-<YYYYMMDD>".
   */
  sessionPrefix?: string;
  /**
   * Provider context window size in tokens.
   * Passed to the LLM provider at creation time.
   */
  contextWindowSize?: number;
  /**
   * Maximum retry attempts per scenario on provider instability.
   * Default: 2.
   */
  maxRetries?: number;
}
