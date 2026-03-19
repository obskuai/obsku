/**
 * Benchmark artifact storage contract: directory structure, path helpers, and
 * directory creation utilities.
 *
 * Directory layout
 * ================
 *
 *   .benchmark-runs/
 *     latest  → {runId}                       (symlink, updated each run)
 *     {runId}/
 *       suite-summary.json
 *       {scenarioName}/
 *         result.json
 *         usage.json
 *         trace.txt
 *         events.jsonl
 *
 *   .benchmark-baselines/
 *     {scenarioName}.baseline.json
 *
 * Retention policy (v1)
 * =====================
 * All artifacts are long-lived with no auto-cleanup, rotation, or TTL.
 * The `latest` symlink is updated atomically on each successful run.
 * Callers are responsible for managing disk space; no purge logic exists in v1.
 */

import { mkdir, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";

// ---------- Well-known names ----------

/** Default root directory for run artifacts (relative to CWD) */
export const BENCHMARK_RUNS_DIR = ".benchmark-runs";

/** Default root directory for baseline snapshots (relative to CWD) */
export const BENCHMARK_BASELINES_DIR = ".benchmark-baselines";

/** Name of the symlink inside BENCHMARK_RUNS_DIR that points to the latest runId */
export const LATEST_LINK_NAME = "latest";

/** File name for the per-scenario result artifact */
export const RESULT_FILENAME = "result.json";

/** File name for the per-scenario token usage artifact */
export const USAGE_FILENAME = "usage.json";

/** File name for the per-scenario human-readable event trace */
export const TRACE_FILENAME = "trace.txt";

/** File name for the per-scenario newline-delimited event stream */
export const EVENTS_JSONL_FILENAME = "events.jsonl";

/** File name for the per-run suite summary */
export const SUITE_SUMMARY_FILENAME = "suite-summary.json";

/** File name for the per-runs index */
export const INDEX_FILENAME = "index.json";

// ---------- Retention ----------

/**
 * Sentinel type documenting the v1 retention policy.
 * All benchmark artifacts are "long-lived" — no auto-cleanup exists.
 */
export type RetentionPolicy = "long-lived";

/** Current retention policy (v1: long-lived, no auto-cleanup). */
export const RETENTION_POLICY: RetentionPolicy = "long-lived";

// ---------- Base directory helpers ----------

/**
 * Returns the root directory for run artifacts.
 * Override with env var BENCHMARK_RUNS_DIR.
 */
export function getRunsBaseDir(): string {
  return process.env["BENCHMARK_RUNS_DIR"] ?? BENCHMARK_RUNS_DIR;
}

/**
 * Returns the root directory for baseline snapshots.
 * Override with env var BENCHMARK_BASELINES_DIR.
 */
export function getBaselinesBaseDir(): string {
  return process.env["BENCHMARK_BASELINES_DIR"] ?? BENCHMARK_BASELINES_DIR;
}

// ---------- Path helpers (all sync, no I/O) ----------

/**
 * Root directory for a specific run.
 *
 * Example: .benchmark-runs/2026-03-15T12-00-00Z-abc123
 */
export function runRootPath(runsBaseDir: string, runId: string): string {
  return join(runsBaseDir, runId);
}

/**
 * Per-scenario subdirectory inside a run.
 *
 * Example: .benchmark-runs/2026-03-15T12-00-00Z-abc123/core-agent
 */
export function scenarioDirPath(runsBaseDir: string, runId: string, scenarioName: string): string {
  return join(runsBaseDir, runId, scenarioName);
}

/**
 * Absolute path to a scenario's result.json.
 *
 * @param scenarioDir - Full path to the scenario directory.
 */
export function resultPath(scenarioDir: string): string {
  return join(scenarioDir, RESULT_FILENAME);
}

/**
 * Absolute path to a scenario's usage.json.
 *
 * @param scenarioDir - Full path to the scenario directory.
 */
export function usagePath(scenarioDir: string): string {
  return join(scenarioDir, USAGE_FILENAME);
}

/**
 * Absolute path to a scenario's trace.txt.
 *
 * @param scenarioDir - Full path to the scenario directory.
 */
export function tracePath(scenarioDir: string): string {
  return join(scenarioDir, TRACE_FILENAME);
}

/**
 * Absolute path to a scenario's events.jsonl.
 *
 * @param scenarioDir - Full path to the scenario directory.
 */
export function eventsJsonlPath(scenarioDir: string): string {
  return join(scenarioDir, EVENTS_JSONL_FILENAME);
}

/**
 * Absolute path to the run-level suite-summary.json.
 *
 * Example: .benchmark-runs/2026-03-15T12-00-00Z-abc123/suite-summary.json
 */
export function suiteSummaryPath(runsBaseDir: string, runId: string): string {
  return join(runsBaseDir, runId, SUITE_SUMMARY_FILENAME);
}

/**
 * Absolute path to the run index file inside the runs directory.
 *
 * Example: .benchmark-runs/index.json
 */
export function indexPath(runsBaseDir: string): string {
  return join(runsBaseDir, INDEX_FILENAME);
}

/**
 * Absolute path to the `latest` symlink inside the runs directory.
 *
 * Example: .benchmark-runs/latest
 */
export function latestLinkPath(runsBaseDir: string): string {
  return join(runsBaseDir, LATEST_LINK_NAME);
}

/**
 * Absolute path to a scenario's baseline snapshot.
 *
 * Example: .benchmark-baselines/core-agent.baseline.json
 */
export function baselinePath(baselinesBaseDir: string, scenarioName: string): string {
  return join(baselinesBaseDir, `${scenarioName}.baseline.json`);
}

// ---------- Directory creation ----------

/**
 * Ensure the per-scenario artifact directory (and all parents) exist.
 * Returns the resolved directory path.
 *
 * Creates: .benchmark-runs/{runId}/{scenarioName}/
 */
export async function ensureScenarioArtifactDir(
  runsBaseDir: string,
  runId: string,
  scenarioName: string
): Promise<string> {
  const dir = scenarioDirPath(runsBaseDir, runId, scenarioName);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Ensure the run root directory (and all parents) exist.
 * Returns the resolved directory path.
 *
 * Creates: .benchmark-runs/{runId}/
 */
export async function ensureRunDir(runsBaseDir: string, runId: string): Promise<string> {
  const dir = runRootPath(runsBaseDir, runId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Ensure the baselines directory (and all parents) exist.
 * Returns the resolved directory path.
 *
 * Creates: .benchmark-baselines/
 */
export async function ensureBaselinesDir(baselinesBaseDir: string): Promise<string> {
  await mkdir(baselinesBaseDir, { recursive: true });
  return baselinesBaseDir;
}

/**
 * Atomically update the `latest` symlink inside runsBaseDir to point to runId.
 *
 * Removes any existing symlink or file at that path before creating the new one.
 * Safe to call concurrently with reads against the previous target; the old
 * target directory is not removed.
 *
 * Retention note: updating `latest` does not delete the previous run directory.
 */
export async function updateLatestLink(runsBaseDir: string, runId: string): Promise<void> {
  const linkPath = latestLinkPath(runsBaseDir);
  // Remove existing symlink/file; ignore ENOENT (first run has no prior link).
  await unlink(linkPath).catch((e: unknown) => {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  });
  await symlink(runId, linkPath);
}
