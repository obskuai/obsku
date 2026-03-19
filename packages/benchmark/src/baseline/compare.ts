import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { baselinePath, ensureBaselinesDir, getBaselinesBaseDir } from "../artifacts/storage";
import { buildSnapshot, toBaselineSnapshot } from "./compare-decode";
import {
  classifyRegressionSeverity,
  compareRuns,
  compareToBaseline,
  detectVersionMismatch,
} from "./compare-diff";
import { createComparisonReport } from "./compare-report";
import type { BaselineSnapshot, ComparisonReport } from "./compare-types";

export type {
  BaselineComparison,
  BaselineSnapshot,
  ComparisonReport,
  ComparisonReportMetric,
  ComparisonReportScenario,
} from "./compare-types";

export const COMPARISON_REPORT_FILENAME = "comparison-report.json";
export async function saveBaseline(
  scenarioName: string,
  scenarioResult: import("../types").ScenarioResult
): Promise<BaselineSnapshot> {
  const baselinesBaseDir = getBaselinesBaseDir();
  await ensureBaselinesDir(baselinesBaseDir);

  const snapshot = buildSnapshot(scenarioName, scenarioResult);
  await writeFile(
    baselinePath(baselinesBaseDir, scenarioName),
    JSON.stringify(snapshot, null, 2),
    "utf8"
  );
  return snapshot;
}

export async function loadBaseline(scenarioName: string): Promise<BaselineSnapshot | null> {
  const baselinesBaseDir = getBaselinesBaseDir();

  try {
    const raw = await readFile(baselinePath(baselinesBaseDir, scenarioName), "utf8");
    return toBaselineSnapshot(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeComparisonReport(
  artifactsDir: string,
  report: ComparisonReport
): Promise<string> {
  const filePath = join(artifactsDir, COMPARISON_REPORT_FILENAME);
  await writeFile(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

export {
  classifyRegressionSeverity,
  compareRuns,
  compareToBaseline,
  createComparisonReport,
  detectVersionMismatch,
};
