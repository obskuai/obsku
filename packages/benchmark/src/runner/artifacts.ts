import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { ensureRunDir, updateLatestLink } from "../artifacts/storage";
import {
  buildSuiteSummary as buildArtifactSuiteSummary,
  writeResult,
  writeRunIndex,
  writeSuiteSummary,
  writeTrace,
  writeUsage,
} from "../artifacts/writers";
import type { BenchmarkRun, RunMetadata, ScenarioResult, SuiteSummary } from "../types";
import type { BenchmarkContext } from "./context";

function gitOutput(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function collectRunMetadata(startTime: Date, endTime: Date): RunMetadata {
  const commit = gitOutput(["rev-parse", "HEAD"]);
  const branch = gitOutput(["branch", "--show-current"]);
  const dirty = gitOutput(["status", "--porcelain"]).length > 0;

  const isBun = typeof Bun !== "undefined";

  return {
    git: { commit, branch, dirty },
    env: {
      runtime: isBun ? "bun" : "node",
      runtimeVersion: isBun ? Bun.version : process.version,
      platform: process.platform,
    },
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  };
}

function buildRunnerSuiteSummary(
  runId: string,
  results: ScenarioResult[],
  startedAt: Date,
  finishedAt: Date,
  abortReason?: SuiteSummary["abortReason"],
  metadata?: RunMetadata
): SuiteSummary {
  const base = buildArtifactSuiteSummary(
    runId,
    startedAt,
    finishedAt,
    results.map((result) => ({
      costUsd: result.usage?.estimatedCostUsd ?? 0,
      errorClass: result.errorClass,
      status: result.status,
    })),
    abortReason,
    metadata
  );

  const skipped = results.filter((result) => result.status === "skipped").length;
  const scored = results.filter((result) => typeof result.compositeScore === "number");
  const avgCompositeScore = scored.length
    ? scored.reduce((sum, result) => sum + (result.compositeScore ?? 0), 0) / scored.length
    : undefined;

  return {
    ...base,
    ...(avgCompositeScore !== undefined ? { avgCompositeScore } : {}),
    skipped,
    totalCostUsd: results.reduce((sum, result) => sum + (result.usage?.estimatedCostUsd ?? 0), 0),
    totalScenarios: results.length,
  };
}

export async function writeSkippedScenarioResult(
  artifactBaseDir: string,
  runId: string,
  result: ScenarioResult,
  scenarioName: string
): Promise<void> {
  const scenarioDir = `${artifactBaseDir}/${runId}/${scenarioName}`;
  await mkdir(scenarioDir, { recursive: true });
  await writeResult(scenarioDir, result);
}

export async function writeScenarioArtifacts(
  baseContext: Pick<BenchmarkContext, "getEvents" | "scenarioDir">,
  result: ScenarioResult,
  scenarioName: string
): Promise<void> {
  const events = [...baseContext.getEvents()];
  await Promise.all([
    writeResult(baseContext.scenarioDir, result),
    writeTrace(baseContext.scenarioDir, events, scenarioName),
    ...(result.usage ? [writeUsage(baseContext.scenarioDir, result.usage)] : []),
  ]);
}

export async function finalizeRunArtifacts(args: {
  artifactBaseDir: string;
  modelId: string;
  runId: string;
  startedAt: Date;
  results: ScenarioResult[];
  abortReason?: SuiteSummary["abortReason"];
  suiteError?: unknown;
  finishedAt: Date;
}): Promise<{ runDir: string; summary: SuiteSummary }> {
  const runDir = await ensureRunDir(args.artifactBaseDir, args.runId);
  const metadata = collectRunMetadata(args.startedAt, args.finishedAt);
  const summary = buildRunnerSuiteSummary(
    args.runId,
    args.results,
    args.startedAt,
    args.finishedAt,
    args.abortReason,
    metadata
  );

  await writeSuiteSummary(runDir, summary);
  await writeRunIndex(args.artifactBaseDir, summary, args.modelId);
  if (!args.suiteError) {
    await updateLatestLink(args.artifactBaseDir, args.runId);
  }

  return { runDir, summary };
}

export function buildBenchmarkRun(args: {
  runDir: string;
  runId: string;
  startedAt: Date;
  finishedAt: Date;
  results: ScenarioResult[];
  spec: BenchmarkRun["spec"];
  suiteName: string;
  summary: SuiteSummary;
}): BenchmarkRun {
  return {
    artifactsPath: args.runDir,
    finishedAt: args.finishedAt.toISOString(),
    runId: args.runId,
    scenarioResults: args.results,
    spec: args.spec,
    startedAt: args.startedAt.toISOString(),
    suiteName: args.suiteName,
    summary: args.summary,
  };
}
