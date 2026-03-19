/**
 * Artifact writer implementations for benchmark runs.
 *
 * Each writer produces one artifact file inside a scenario or run directory.
 * Path helpers are imported from storage.ts — no raw path construction here.
 *
 * Output layout (managed by storage.ts):
 *   .benchmark-runs/{runId}/{scenarioName}/result.json
 *   .benchmark-runs/{runId}/{scenarioName}/trace.txt
 *   .benchmark-runs/{runId}/{scenarioName}/usage.json
 *   .benchmark-runs/{runId}/{scenarioName}/events.jsonl
 *   .benchmark-runs/{runId}/suite-summary.json
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord, type CanonicalAgentEvent } from "@obsku/framework";
import type { RunMetadata } from "../types";
import type { ScenarioResult, ScenarioUsage, SuiteSummary } from "./schemas";
import {
  eventsJsonlPath,
  indexPath,
  resultPath,
  SUITE_SUMMARY_FILENAME,
  tracePath,
  usagePath,
} from "./storage";
const MAX_TRACE_PREVIEW_LENGTH = 200;

// ---------- result.json ----------


// ---------- result.json ----------

/**
 * Write per-scenario result artifact.
 *
 * @param scenarioDir - Full path to the scenario artifact directory.
 * @param result      - Scenario result to serialize.
 */
export async function writeResult(scenarioDir: string, result: ScenarioResult): Promise<void> {
  await writeFile(resultPath(scenarioDir), JSON.stringify(result, null, 2), "utf8");
}

// ---------- trace.txt ----------

function formatEvent(event: CanonicalAgentEvent): string | null {
  switch (event.type) {
    case "session.start":
      return `[SESSION START] sessionId=${event.sessionId ?? "?"}`;
    case "session.end":
      return `[SESSION END]`;
    case "turn.start":
      return `[TURN START] turnId=${event.turnId ?? "?"}`;
    case "turn.end":
      return `[TURN END] turnId=${event.turnId ?? "?"}`;
    case "tool.call": {
      const argsStr = JSON.stringify(event.args).slice(0, MAX_TRACE_PREVIEW_LENGTH);
      return `[TOOL CALL] ${event.toolName} (${event.toolUseId}) args=${argsStr}`;
    }
    case "tool.result": {
      const status = event.isError ? "ERROR" : "OK";
      return `[TOOL RESULT] ${event.toolName} (${event.toolUseId}) status=${status}`;
    }
    case "agent.complete": {
      return `[AGENT COMPLETE] llmCalls=${event.usage?.llmCalls ?? "?"}`;
    }
    case "agent.error": {
      const msg = event.message ?? "?";
      return `[AGENT ERROR] ${msg.slice(0, MAX_TRACE_PREVIEW_LENGTH)}`;
    }
    case "agent.transition": {
      return `[AGENT TRANSITION] → ${event.to ?? "?"}`;
    }
    case "checkpoint.saved": {
      return `[CHECKPOINT SAVED] id=${event.checkpointId}`;
    }
    case "context.compacted": {
      return `[CONTEXT COMPACTED] saved≈${event.estimatedTokensSaved}tokens`;
    }
    case "context.pruned": {
      return `[CONTEXT PRUNED] removed=${event.removedMessages}msgs`;
    }
    default:
      return `[${event.type}]`;
  }
}

/**
 * Write per-scenario human-readable event trace.
 *
 * @param scenarioDir  - Full path to the scenario artifact directory.
 * @param events       - Ordered list of events captured during the scenario.
 * @param scenarioName - Scenario name shown in the header.
 */
export async function writeTrace(
  scenarioDir: string,
  events: CanonicalAgentEvent[],
  scenarioName: string
): Promise<void> {
  const toolCalls = events.filter((e) => e.type === "tool.call").length;
  const toolErrors = events.filter((e) => e.type === "tool.result" && e.isError).length;
  const turnStarts = events.filter((e) => e.type === "turn.start").length;

  const lines: string[] = [
    `SCENARIO: ${scenarioName}`,
    `EVENTS:   ${events.length} total`,
    `LLM TURNS: ${turnStarts}`,
    `TOOL CALLS: ${toolCalls} (${toolErrors} errors)`,
    "",
    "--- EVENT TRACE ---",
  ];

  for (const event of events) {
    const formatted = formatEvent(event);
    if (formatted) lines.push(formatted);
  }

  await writeFile(tracePath(scenarioDir), lines.join("\n") + "\n", "utf8");
}

// ---------- usage.json ----------

// Nova Lite on-demand rates (USD per token) — used when Bedrock usage metadata is unavailable.
const NOVA_LITE_INPUT_RATE = 0.00003 / 1000;
const NOVA_LITE_OUTPUT_RATE = 0.00003 / 1000;

/**
 * Estimate cost in USD from raw token counts using Nova Lite on-demand rates.
 * Used when provider billing metadata is unavailable.
 */
export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return inputTokens * NOVA_LITE_INPUT_RATE + outputTokens * NOVA_LITE_OUTPUT_RATE;
}

/**
 * Build a ScenarioUsage object from token counts and optional provider metadata.
 *
 * @param inputTokens     - Total input tokens consumed across all LLM calls.
 * @param outputTokens    - Total output tokens generated across all LLM calls.
 * @param providerMetadata - Raw provider billing metadata (when available).
 */
export function buildUsage(
  inputTokens: number,
  outputTokens: number,
  providerMetadata?: Record<string, unknown>
): ScenarioUsage {
  const hasProviderData = providerMetadata != null;
  return {
    estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens),
    estimated: !hasProviderData,
    inputTokens,
    outputTokens,
    ...(hasProviderData ? { providerMetadata } : {}),
  };
}

/**
 * Write per-scenario token usage artifact.
 *
 * @param scenarioDir - Full path to the scenario artifact directory.
 * @param usage       - Usage data to serialize.
 */
export async function writeUsage(scenarioDir: string, usage: ScenarioUsage): Promise<void> {
  await writeFile(usagePath(scenarioDir), JSON.stringify(usage, null, 2), "utf8");
}

// ---------- events.jsonl ----------

/**
 * Append a single event to the scenario's events.jsonl stream.
 *
 * @param scenarioDir - Full path to the scenario artifact directory.
 * @param event       - Event to append as a JSON line.
 */
export async function appendEventJsonl(
  scenarioDir: string,
  event: CanonicalAgentEvent
): Promise<void> {
  await appendFile(eventsJsonlPath(scenarioDir), JSON.stringify(event) + "\n", "utf8");
}

// ---------- suite-summary.json ----------

/**
 * Build a SuiteSummary from run metadata and per-scenario result shapes.
 *
 * @param runId       - Unique run identifier.
 * @param startedAt   - Suite start timestamp.
 * @param finishedAt  - Suite end timestamp.
 * @param results     - Minimal per-scenario result shapes (status + cost).
 * @param abortReason - Optional abort reason if the suite did not complete normally.
 * @param metadata    - Optional git + env metadata collected at run start.
 */
export function buildSuiteSummary(
  runId: string,
  startedAt: Date,
  finishedAt: Date,
  results: Array<{
    status: string;
    errorClass?: string;
    costUsd: number;
  }>,
  abortReason?: SuiteSummary["abortReason"],
  metadata?: RunMetadata
): SuiteSummary {
  let passed = 0;
  let failed = 0;
  let providerInstability = 0;
  let totalCostUsd = 0;

  for (const scenarioResult of results) {
    totalCostUsd += scenarioResult.costUsd;
    if (scenarioResult.status === "pass") {
      passed++;
    } else if (scenarioResult.errorClass === "provider_instability") {
      providerInstability++;
    } else {
      failed++;
    }
  }

  const summary: SuiteSummary = {
    failed,
    finishedAt: finishedAt.toISOString(),
    passed,
    providerInstability,
    runId,
    startedAt: startedAt.toISOString(),
    totalCostUsd,
    totalScenarios: results.length,
  };

  if (abortReason) {
    summary.abortReason = abortReason;
  }

  if (metadata) {
    summary.metadata = metadata;
  }

  return summary;
}

/**
 * Write the run-level suite summary artifact.
 *
 * @param runDir  - Full path to the run root directory (.benchmark-runs/{runId}).
 * @param summary - Suite summary to serialize.
 */
export async function writeSuiteSummary(runDir: string, summary: SuiteSummary): Promise<void> {
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, SUITE_SUMMARY_FILENAME), JSON.stringify(summary, null, 2), "utf8");
}

// ---------- index.json ----------

/**
 * One entry in the top-level run index.
 */
export interface RunIndexEntry {
  /** Unique run identifier. */
  runId: string;
  /** ISO-8601 timestamp when the suite started. */
  timestamp: string;
  /** Bedrock model ID used for this run. */
  modelId: string;
  /** Total number of scenarios attempted (including skipped). */
  totalScenarios: number;
  /** Count of scenarios with status "pass". */
  passed: number;
  /** Count of scenarios with status "fail" or "error". */
  failed: number;
  /**
   * Weighted average composite score across all scored scenarios.
   * Absent when no scoring criteria were defined.
   */
  avgCompositeScore?: number;
}

/**
 * Top-level index file: a chronological list of all completed runs.
 */
export interface RunIndex {
  runs: RunIndexEntry[];
}

/**
 * Read the existing index.json (or start with an empty index), append a new
 * entry for the completed run, and write the file back.
 *
 * @param runsBaseDir - Root runs directory (e.g. ".benchmark-runs").
 * @param summary     - Suite summary for the completed run.
 * @param modelId     - Model ID used for the run.
 */
export async function writeRunIndex(
  runsBaseDir: string,
  summary: SuiteSummary,
  modelId: string
): Promise<void> {
  const path = indexPath(runsBaseDir);

  let index: RunIndex = { runs: [] };
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      isRecord(parsed) &&
      "runs" in parsed &&
      Array.isArray(parsed.runs)
    ) {
      index = parsed as unknown as RunIndex;
    }
  } catch {
    // File does not exist yet — start fresh.
  }

  const entry: RunIndexEntry = {
    runId: summary.runId,
    timestamp: summary.startedAt,
    modelId,
    totalScenarios: summary.totalScenarios,
    passed: summary.passed,
    failed: summary.failed,
    ...(summary.avgCompositeScore !== undefined
      ? { avgCompositeScore: summary.avgCompositeScore }
      : {}),
  };

  index.runs.push(entry);

  await mkdir(runsBaseDir, { recursive: true });
  await writeFile(path, JSON.stringify(index, null, 2), "utf8");
}
