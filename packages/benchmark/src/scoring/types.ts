/**
 * Tolerance band for metric pass/fail evaluation.
 *
 * Supports three modes:
 * - Range: `min` / `max` (inclusive bounds on the score itself)
 * - Delta: `expected` + `delta` — score must satisfy |score - expected| <= delta
 *
 * Any combination is valid; all set constraints must be satisfied for `passed = true`.
 */
export interface ToleranceBand {
  /** Minimum acceptable score (inclusive). */
  min?: number;
  /** Maximum acceptable score (inclusive). */
  max?: number;
  /**
   * Symmetric tolerance around `expected`.
   * When set, `expected` must also be provided.
   * Pass condition: Math.abs(score - expected) <= delta
   */
  delta?: number;
  /**
   * Reference value for delta comparison.
   * Required when `delta` is set.
   */
  expected?: number;
}

/**
 * Result produced by a Scorer for a single metric or aggregated scenario output.
 */
export interface MetricResult {
  /** Primary numeric score. Typically 0–1 for ratios, or raw counts/tokens. */
  score: number;
  /** Tolerance configuration used to derive `passed`. */
  tolerance: ToleranceBand;
  /** Whether the score satisfies all constraints in `tolerance`. */
  passed: boolean;
  /**
   * Named sub-metrics for observability.
   * Examples: { turnCount: 2, toolCallCount: 3, inputTokens: 400 }
   */
  metrics: Record<string, number>;
  /** Optional human-readable explanation of the pass/fail decision. */
  reason?: string;
  /** Version of the scorer that produced this metric. */
  scorerVersion?: string;
}

/**
 * Evaluates whether a numeric score satisfies a ToleranceBand.
 *
 * All constraints present in the band must hold simultaneously.
 */
export interface ToleranceEvaluator {
  evaluate(score: number, tolerance: ToleranceBand): boolean;
}

/**
 * Generic Scorer interface.
 *
 * A Scorer takes scenario `input` and `output` and produces a MetricResult
 * containing a score, tolerance band, pass/fail verdict, and sub-metrics.
 *
 * Implementations should be deterministic — no LLM calls, no I/O.
 * LLM-based evaluation belongs in Judge (see judge.ts).
 *
 * @template TInput  - Type of scenario input (e.g. scenario config, prompt, messages)
 * @template TOutput - Type of scenario output (e.g. final text, collected events, usage)
 */
export interface Scorer<TInput, TOutput> {
  /** Unique name identifying this scorer. */
  readonly name: string;
  /** Version of this scorer for tracking changes to scoring logic. */
  readonly version: string;
  /**
   * Compute a MetricResult from the scenario input and output.
   * Must not throw; encode failures in `passed: false` with a `reason`.
   */
  score(input: TInput, output: TOutput): MetricResult;
}

/**
 * Convenience helper: evaluates a score against a tolerance band.
 * Returns true when all defined constraints are satisfied.
 */
export function evaluateTolerance(score: number, tolerance: ToleranceBand): boolean {
  if (tolerance.min !== undefined && score < tolerance.min) return false;
  if (tolerance.max !== undefined && score > tolerance.max) return false;
  if (tolerance.delta !== undefined && tolerance.expected !== undefined) {
    if (Math.abs(score - tolerance.expected) > tolerance.delta) return false;
  }
  return true;
}

/**
 * Build a MetricResult, deriving `passed` automatically from the tolerance band.
 */
export function buildMetricResult(
  score: number,
  tolerance: ToleranceBand,
  metrics: Record<string, number>,
  reason?: string,
  scorerVersion?: string
): MetricResult {
  return {
    score,
    tolerance,
    passed: evaluateTolerance(score, tolerance),
    metrics,
    ...(reason !== undefined ? { reason } : {}),
    ...(scorerVersion !== undefined ? { scorerVersion } : {}),
  };
}
