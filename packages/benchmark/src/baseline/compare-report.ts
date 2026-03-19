import {
  buildReportMetrics,
  classifyRegressionSeverity,
  detectVersionMismatch,
} from "./compare-diff";
import type {
  BaselineComparison,
  BaselineSnapshot,
  ComparisonReport,
  ComparisonReportInput,
} from "./compare-types";

function buildBaselineMetadataScenarios(
  scenarios: ComparisonReportInput["scenarios"]
): ComparisonReport["baselineMetadata"]["scenarios"] {
  return scenarios
    .filter(
      (entry): entry is { comparison: BaselineComparison; snapshot: BaselineSnapshot } =>
        entry.snapshot !== null
    )
    .map(({ snapshot }) => ({
      modelId: snapshot.modelId,
      scenarioName: snapshot.scenarioName,
      timestamp: snapshot.timestamp,
    }))
    .sort((left, right) => left.scenarioName.localeCompare(right.scenarioName));
}

function buildComparisonScenario(
  comparison: BaselineComparison,
  snapshot: BaselineSnapshot | null
): ComparisonReport["scenarios"][number] {
  const baselineVersion = comparison.baseline?.scenarioVersion ?? null;
  const contenderVersion = comparison.current.scenarioVersion ?? null;
  const { versionMismatch, versionMismatchWarning } = detectVersionMismatch(
    baselineVersion,
    contenderVersion,
    comparison.scenarioName
  );

  if (versionMismatch && versionMismatchWarning) {
    console.warn(`[benchmark] ${versionMismatchWarning}`);
  }

  return {
    baselineModelId: snapshot?.modelId ?? null,
    baselineScore: comparison.baseline?.compositeScore ?? null,
    baselineStatus: comparison.baseline?.status ?? null,
    baselineTimestamp: snapshot?.timestamp ?? null,
    contenderModelId: comparison.current.modelId,
    contenderScore: comparison.current.compositeScore ?? null,
    contenderStatus: comparison.current.status,
    delta:
      comparison.baseline && typeof comparison.current.compositeScore === "number"
        ? (comparison.current.compositeScore ?? 0) - (comparison.baseline.compositeScore ?? 0)
        : null,
    metrics: buildReportMetrics(comparison.current, comparison.baseline),
    regressionSeverity: classifyRegressionSeverity(comparison.current, comparison.baseline),
    scenarioName: comparison.scenarioName,
    scenarioVersion: {
      baseline: baselineVersion,
      contender: contenderVersion,
    },
    versionMismatch,
    versionMismatchWarning,
  };
}

export function createComparisonReport(input: ComparisonReportInput): ComparisonReport {
  return {
    baselineMetadata: {
      runId: null,
      scenarios: buildBaselineMetadataScenarios(input.scenarios),
      source: "scenario-baselines",
    },
    baselineRunId: null,
    contenderMetadata: {
      finishedAt: input.contenderFinishedAt,
      metadata: input.contenderMetadata,
      modelId: input.contenderModelId,
      runId: input.contenderRunId,
      startedAt: input.contenderStartedAt,
    },
    contenderRunId: input.contenderRunId,
    scenarios: input.scenarios.map(({ comparison, snapshot }) =>
      buildComparisonScenario(comparison, snapshot)
    ),
    timestamp: new Date().toISOString(),
  } satisfies ComparisonReport;
}
