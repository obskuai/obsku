import type { RunMetadata } from "../types/run";

/**
 * TypeScript interfaces for benchmark artifact JSON structures.
 *
 * All interfaces mirror the on-disk JSON format exactly.
 * No runtime parsing or I/O helpers live here — see storage.ts for those.
 *
 * Retention policy (v1): all artifacts are long-lived with no auto-cleanup.
 */

// ---------- Error classification ----------

export type ErrorClass = "framework_regression" | "provider_instability" | "unknown";

export type ScenarioStatus = "pass" | "fail" | "error" | "skipped";

// ---------- result.json ----------

/**
 * Detailed output from a single scorer.
 */
export interface ScorerDetail {
  /** Normalized score 0–1 (1 = best) */
  score: number;
  /** Human-readable explanation of the score */
  reason?: string;
  /** Raw scorer-specific data for debugging */
  raw?: unknown;
}

/**
 * Per-scenario result artifact.
 *
 * Written to: .benchmark-runs/{runId}/{scenarioName}/result.json
 */
export interface ScenarioResult {
  /** Scenario identifier matching the scenario definition name */
  scenarioName: string;
  /** Bedrock model ID used for this run (e.g. "amazon.nova-lite-v1:0") */
  modelId: string;
  /** Final outcome status */
  status: ScenarioStatus;
  /** Elapsed wall-clock time in milliseconds */
  durationMs: number;
  /** Number of retry attempts made (0 = first attempt succeeded) */
  retries: number;
  /** Error classification; present when status is not "pass" */
  errorClass?: ErrorClass;
  /** Human-readable error message; present when status is not "pass" */
  errorMessage?: string;
  /** Error stack trace; present when status is not "pass" */
  errorStack?: string;
  /** Per-scorer numeric scores, keyed by scorer name (range: 0–1, 1 = best) */
  scores?: Record<string, number>;
  /** Detailed scorer output keyed by scorer name */
  scorerDetails?: Record<string, ScorerDetail>;
  /** Scenario tags for grouping and filtering */
  tags?: string[];
}

// ---------- usage.json ----------

/**
 * Token usage and cost artifact.
 *
 * Written to: .benchmark-runs/{runId}/{scenarioName}/usage.json
 */
export interface ScenarioUsage {
  /** Total input tokens consumed across all LLM calls in this scenario */
  inputTokens: number;
  /** Total output tokens generated across all LLM calls in this scenario */
  outputTokens: number;
  /** Estimated total cost in USD for this scenario */
  estimatedCostUsd: number;
  /**
   * true when cost is estimated from token counts (no provider billing metadata),
   * false or absent when derived from provider-reported billing data.
   */
  estimated?: boolean;
  /** Raw provider billing metadata when available (e.g. Bedrock usage response) */
  providerMetadata?: Record<string, unknown>;
}

// ---------- suite-summary.json ----------

/**
 * Suite-level summary artifact.
 *
 * Written to: .benchmark-runs/{runId}/suite-summary.json
 */
export interface SuiteSummary {
  /** Unique run identifier (e.g. ISO timestamp + short random suffix) */
  runId: string;
  /** ISO-8601 timestamp when the suite started */
  startedAt: string;
  /** ISO-8601 timestamp when the suite finished */
  finishedAt: string;
  /** Total number of scenarios attempted (including skipped) */
  totalScenarios: number;
  /** Number of scenarios with status "pass" */
  passed: number;
  /** Number of scenarios with a framework_regression error */
  failed: number;
  /** Number of scenarios with provider_instability (transient, not release-blocking) */
  providerInstability: number;
  skipped?: number;
  /** Sum of estimatedCostUsd across all scenarios */
  totalCostUsd: number;
  avgCompositeScore?: number;
  /** Non-null when the suite was aborted before all scenarios completed */
  abortReason?: "budget_exceeded" | "wall_clock_exceeded";
  /** Model IDs tested in this run (may include multiple when comparing models) */
  models?: string[];
  /** Scenario names executed in declaration order */
  scenarios?: string[];
  /** Git provenance and runtime environment captured at suite start. */
  metadata?: RunMetadata;
}

// ---------- events.jsonl ----------

/**
 * Minimal parse-safe representation of a single line in events.jsonl.
 *
 * Each line is a JSON-serialized CanonicalAgentEvent from @obsku/framework.
 * The full type is defined by the framework's event envelope; this interface
 * provides a safe minimal shape for consumers that don't import framework types.
 */
export interface AgentEventLine {
  /** Event type discriminator (e.g. "tool.call", "turn.start") */
  type: string;
  /** Remaining event payload fields (structure varies by event type) */
  [key: string]: unknown;
}

// ---------- baseline JSON ----------

/**
 * Baseline snapshot for a single scenario.
 *
 * Written to: .benchmark-baselines/{scenarioName}.baseline.json
 *
 * Retention policy (v1): baselines are long-lived and updated only by
 * an explicit baseline-promotion step; no auto-rotation or TTL exists.
 */
export interface BaselineRecord {
  /** Scenario identifier this baseline covers */
  scenarioName: string;
  /** ISO-8601 timestamp when this baseline was captured */
  capturedAt: string;
  /** Model ID used when this baseline was captured */
  modelId: string;
  /** Per-scorer scores at capture time (range: 0–1, 1 = best) */
  scores: Record<string, number>;
  /** Full scenario result snapshot at capture time */
  result: ScenarioResult;
  /** Full usage snapshot at capture time */
  usage: ScenarioUsage;
}
