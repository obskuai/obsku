#!/usr/bin/env bun
/**
 * @obsku/benchmark CLI
 *
 * Usage: bun packages/benchmark/src/cli.ts --model <bedrock-model-id> [options]
 */

import { getErrorMessage } from "@obsku/framework";

import { getBaselinesBaseDir, getRunsBaseDir } from "./artifacts/storage";
import { createComparisonReport, writeComparisonReport } from "./baseline/compare";
import { compareToBaseline, loadBaseline, saveBaseline } from "./baseline/index";
import { fmtCost, fmtDelta, fmtScore, fmtStatus } from "./cli/formatters";
import {
  ALL_SCENARIOS,
  DEFAULT_BUDGET_USD,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  parseArgs,
  showHelp,
} from "./cli/parse-args";
import type { BenchmarkContext } from "./runner/index";
import { runBenchmarkSuite } from "./runner/index";
import type { RunSpec, Scenario, Suite } from "./types/index";

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (!args.model) {
    console.error("Error: --model is required.");
    console.error("Run with --help for usage.");
    process.exit(1);
  }

  // Build RunSpec from CLI args + environment
  const spec: RunSpec = {
    artifactBaseDir: getRunsBaseDir(),
    budgetUsd: Number(process.env["BENCHMARK_MAX_COST_USD"] ?? DEFAULT_BUDGET_USD),
    maxRetries: DEFAULT_MAX_RETRIES,
    modelId: args.model,
    region: process.env["AWS_REGION"] ?? "us-east-1",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  // Apply optional scenario filter
  let scenariosToRun: Array<Scenario<BenchmarkContext>> = ALL_SCENARIOS;
  if (args.scenario) {
    const name = args.scenario;
    scenariosToRun = ALL_SCENARIOS.filter((s) => s.name === name);
    if (scenariosToRun.length === 0) {
      console.error(
        `Error: unknown scenario "${name}". Valid: ${ALL_SCENARIOS.map((s) => s.name).join(", ")}`
      );
      process.exit(1);
    }
  }

  const suite: Suite<BenchmarkContext> = {
    config: {
      interScenarioDelayMs: 3_000,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    },
    description: "Obsku framework benchmark suite",
    name: "obsku-benchmark",
    scenarios: scenariosToRun,
  };

  // Print run header
  console.log("Benchmark run");
  console.log(`  Model:     ${spec.modelId}`);
  console.log(`  Region:    ${spec.region ?? "us-east-1"}`);
  console.log(`  Budget:    $${spec.budgetUsd}`);
  console.log(`  Scenarios: ${scenariosToRun.map((s) => s.name).join(", ")}`);
  console.log("");

  // Execute suite
  let run;
  try {
    run = await runBenchmarkSuite(suite, spec);
  } catch (error) {
    console.error(`Fatal error: ${getErrorMessage(error)}`);
    process.exit(1);
  }

  const { summary, scenarioResults, artifactsPath } = run;

  // Per-scenario result rows
  console.log("=== Scenario Results ===");
  for (const result of scenarioResults) {
    const scoreStr = fmtScore(result.compositeScore);
    const costStr = fmtCost(result.usage?.estimatedCostUsd);
    const errStr = result.errorMessage ? ` err="${result.errorMessage.slice(0, 80)}"` : "";
    console.log(
      `  ${fmtStatus(result.status)} ${result.scenarioName}${scoreStr}${costStr}${errStr}`
    );
  }
  console.log("");

  // Suite summary JSON
  console.log("=== Suite Summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("");

  console.log(`Artifacts: ${artifactsPath}`);

  // --save-baseline: persist passing results as new baselines
  if (args.saveBaseline) {
    console.log("\nSaving baselines...");
    for (const result of scenarioResults) {
      if (result.status === "pass") {
        const snapshot = await saveBaseline(result.scenarioName, result);
        const savedPath = getBaselinesBaseDir() + "/" + result.scenarioName + ".baseline.json";
        console.log(
          `  Saved: ${result.scenarioName} (score=${fmtDelta(snapshot.compositeScore ?? 0)}) → ${savedPath}`
        );
      } else {
        console.log(`  Skipped ${result.scenarioName} (status=${result.status})`);
      }
    }
  }

  // --compare-to: compare each result against existing baselines
  let baselineRegressions = 0;
  if (args.compareTo) {
    const comparisonEntries: Array<{
      comparison: ReturnType<typeof compareToBaseline>;
      snapshot: Awaited<ReturnType<typeof loadBaseline>>;
    }> = [];

    console.log("\nComparing to baselines...");
    for (const result of scenarioResults) {
      const snapshot = await loadBaseline(result.scenarioName);
      const comparison = compareToBaseline(result, snapshot);
      comparisonEntries.push({ comparison, snapshot });

      if (comparison.baseline === null) {
        console.log(`  ${result.scenarioName}: no baseline found`);
      } else if (!comparison.passed) {
        const deltaStr =
          typeof comparison.deltas["compositeScore"] === "number"
            ? ` Δscore=${fmtDelta(comparison.deltas["compositeScore"])}`
            : "";
        console.log(`  REGRESSION ${result.scenarioName}${deltaStr} (status=${result.status})`);
        baselineRegressions++;
      } else {
        const deltaStr =
          typeof comparison.deltas["compositeScore"] === "number"
            ? ` Δscore=${fmtDelta(comparison.deltas["compositeScore"])}`
            : "";
        console.log(`  OK ${result.scenarioName}${deltaStr}`);
      }
    }

    await writeComparisonReport(
      artifactsPath,
      createComparisonReport({
        contenderFinishedAt: summary.finishedAt,
        contenderMetadata: summary.metadata,
        contenderModelId: spec.modelId,
        contenderRunId: summary.runId,
        contenderStartedAt: summary.startedAt,
        scenarios: comparisonEntries,
      })
    );

    if (baselineRegressions > 0) {
      console.error(`\n${baselineRegressions} baseline regression(s) detected.`);
    }
  }

  // Determine exit code
  if (summary.abortReason) {
    console.error(`\nSuite aborted: ${summary.abortReason}`);
    process.exit(1);
  }

  if (baselineRegressions > 0) {
    process.exit(1);
  }

  const failures = summary.failed + summary.providerInstability;
  if (failures > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
