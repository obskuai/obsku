import type {
  BaselineComparison,
  BaselineSnapshot,
  BenchmarkRun,
  MetricResult,
  ScenarioResult,
} from "./compare-types";

function metricScoreMap(result: ScenarioResult | null): Map<string, MetricResult> {
  return new Map((result?.metrics ?? []).map((metric) => [metric.name, metric]));
}

function evaluateComparisonPass(current: ScenarioResult, baseline: ScenarioResult | null): boolean {
  if (!baseline) return false;
  if (current.status !== "pass") return false;

  const currentMetrics = current.metrics ?? [];
  const baselineMetrics = metricScoreMap(baseline);

  const metricsPassed = currentMetrics.every((metric) => {
    const withinTolerance = metric.passed;
    const baselineMetric = baselineMetrics.get(metric.name);
    const noRegression = baselineMetric
      ? metric.score >= baselineMetric.score || metric.passed
      : metric.passed;
    return withinTolerance && noRegression;
  });

  const compositePassed =
    baseline.compositeScore == null ||
    current.compositeScore == null ||
    current.compositeScore >= baseline.compositeScore;

  return metricsPassed && compositePassed;
}

export function buildReportMetrics(current: ScenarioResult, baseline: ScenarioResult | null) {
  const currentMetrics = metricScoreMap(current);
  const baselineMetrics = metricScoreMap(baseline);
  const metricNames = new Set([...currentMetrics.keys(), ...baselineMetrics.keys()]);

  return [...metricNames].sort().map((metricName) => {
    const currentMetric = currentMetrics.get(metricName) ?? null;
    const baselineMetric = baselineMetrics.get(metricName) ?? null;

    return {
      baselinePassed: baselineMetric?.passed ?? null,
      baselineScore: baselineMetric?.score ?? null,
      baselineScorerVersion: baselineMetric?.scorerVersion,
      contenderPassed: currentMetric?.passed ?? null,
      contenderScore: currentMetric?.score ?? null,
      contenderScorerVersion: currentMetric?.scorerVersion,
      delta: currentMetric && baselineMetric ? currentMetric.score - baselineMetric.score : null,
      name: metricName,
    };
  });
}

export function classifyRegressionSeverity(
  current: ScenarioResult,
  baseline: ScenarioResult | null
): "none" | "warning" | "critical" {
  if (!baseline) return "none";
  if (current.status !== "pass") return "critical";

  const currentMetrics = current.metrics ?? [];
  const baselineMetrics = metricScoreMap(baseline);
  let hasScoreDrop = false;

  for (const metric of currentMetrics) {
    if (!metric.passed) return "critical";
    const baselineMetric = baselineMetrics.get(metric.name);
    if (baselineMetric && metric.score < baselineMetric.score) {
      hasScoreDrop = true;
    }
  }

  const currentComposite = current.compositeScore ?? null;
  const baselineComposite = baseline.compositeScore ?? null;
  if (
    currentComposite !== null &&
    baselineComposite !== null &&
    currentComposite < baselineComposite
  ) {
    hasScoreDrop = true;
  }

  return hasScoreDrop ? "warning" : "none";
}

export function detectVersionMismatch(
  baselineVersion: string | null,
  contenderVersion: string | null,
  scenarioName: string
): { versionMismatch: boolean; versionMismatchWarning: string | null } {
  if (baselineVersion == null || contenderVersion == null) {
    return { versionMismatch: false, versionMismatchWarning: null };
  }
  if (baselineVersion !== contenderVersion) {
    const warning = `Scenario version mismatch for "${scenarioName}": baseline=${baselineVersion}, contender=${contenderVersion}`;
    return { versionMismatch: true, versionMismatchWarning: warning };
  }
  return { versionMismatch: false, versionMismatchWarning: null };
}

export function compareToBaseline(
  current: ScenarioResult,
  baseline: BaselineSnapshot | ScenarioResult | null
): BaselineComparison {
  const baselineResult = baseline && "result" in baseline ? baseline.result : baseline;
  const currentMetrics = metricScoreMap(current);
  const baselineMetrics = metricScoreMap(baselineResult);
  const metricNames = new Set([...currentMetrics.keys(), ...baselineMetrics.keys()]);
  const deltas: Record<string, number> = {};

  deltas["compositeScore"] = (current.compositeScore ?? 0) - (baselineResult?.compositeScore ?? 0);

  for (const metricName of metricNames) {
    deltas[metricName] =
      (currentMetrics.get(metricName)?.score ?? 0) - (baselineMetrics.get(metricName)?.score ?? 0);
  }

  return {
    baseline: baselineResult,
    current,
    deltas,
    passed: evaluateComparisonPass(current, baselineResult),
    scenarioName: current.scenarioName,
  } satisfies BaselineComparison;
}

export function compareRuns(run1: BenchmarkRun, run2: BenchmarkRun): BaselineComparison[] {
  const baselineByScenario = new Map(
    run2.scenarioResults.map((scenarioResult) => [scenarioResult.scenarioName, scenarioResult])
  );

  return run1.scenarioResults.map((scenarioResult) =>
    compareToBaseline(scenarioResult, baselineByScenario.get(scenarioResult.scenarioName) ?? null)
  );
}
