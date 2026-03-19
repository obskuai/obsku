import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScenarioResult } from "../types";
import type { BaselineSnapshot } from "./compare";
import {
  classifyRegressionSeverity,
  compareToBaseline,
  createComparisonReport,
  detectVersionMismatch,
  loadBaseline,
  writeComparisonReport,
} from "./compare";

// ---------- helpers ----------

function makeResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    compositeScore: 1.0,
    durationMs: 100,
    modelId: "model-a",
    retries: 0,
    scenarioName: "test-scenario",
    status: "pass",
    ...overrides,
  };
}

function makeMetric(name: string, score: number, passed: boolean, scorerVersion?: string) {
  return {
    name,
    passed,
    score,
    scorerVersion,
    toleranceBand: { max: 1, min: 0.5 },
    weight: 1,
  };
}

function makeSnapshot(result: ScenarioResult): BaselineSnapshot {
  return {
    compositeScore: result.compositeScore ?? 1,
    metrics: result.metrics ?? [],
    modelId: result.modelId,
    result,
    scenarioName: result.scenarioName,
    timestamp: "2026-01-01T00:00:00.000Z",
  };
}

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

const cleanupDirs: string[] = [];

afterAll(async () => {
  await Promise.all(cleanupDirs.map((dir) => rm(dir, { force: true, recursive: true })));
});

// ---------- classifyRegressionSeverity ----------

describe("classifyRegressionSeverity", () => {
  test('returns "none" when baseline is null', () => {
    const current = makeResult();
    expect(classifyRegressionSeverity(current, null)).toBe("none");
  });

  test('returns "critical" when current status is not pass', () => {
    const current = makeResult({ status: "fail" });
    const baseline = makeResult();
    expect(classifyRegressionSeverity(current, baseline)).toBe("critical");
  });

  test('returns "critical" when current status is error', () => {
    const current = makeResult({ status: "error" });
    const baseline = makeResult();
    expect(classifyRegressionSeverity(current, baseline)).toBe("critical");
  });

  test('returns "critical" when a metric failed', () => {
    const current = makeResult({
      metrics: [makeMetric("accuracy", 0.4, false)],
      status: "pass",
    });
    const baseline = makeResult({
      metrics: [makeMetric("accuracy", 0.8, true)],
    });
    expect(classifyRegressionSeverity(current, baseline)).toBe("critical");
  });

  test('returns "warning" when metric score dropped but still passing', () => {
    const current = makeResult({
      compositeScore: 0.9,
      metrics: [makeMetric("accuracy", 0.7, true)],
      status: "pass",
    });
    const baseline = makeResult({
      compositeScore: 0.95,
      metrics: [makeMetric("accuracy", 0.9, true)],
    });
    expect(classifyRegressionSeverity(current, baseline)).toBe("warning");
  });

  test('returns "warning" when composite score dropped and all metrics pass', () => {
    const current = makeResult({
      compositeScore: 0.7,
      metrics: [makeMetric("accuracy", 0.8, true)],
      status: "pass",
    });
    const baseline = makeResult({
      compositeScore: 0.9,
      metrics: [makeMetric("accuracy", 0.8, true)],
    });
    expect(classifyRegressionSeverity(current, baseline)).toBe("warning");
  });

  test('returns "none" when all metrics pass and scores same', () => {
    const current = makeResult({
      compositeScore: 0.9,
      metrics: [makeMetric("accuracy", 0.9, true)],
      status: "pass",
    });
    const baseline = makeResult({
      compositeScore: 0.9,
      metrics: [makeMetric("accuracy", 0.9, true)],
    });
    expect(classifyRegressionSeverity(current, baseline)).toBe("none");
  });

  test('returns "none" when all metrics pass and scores improved', () => {
    const current = makeResult({
      compositeScore: 0.95,
      metrics: [makeMetric("accuracy", 0.95, true)],
      status: "pass",
    });
    const baseline = makeResult({
      compositeScore: 0.9,
      metrics: [makeMetric("accuracy", 0.9, true)],
    });
    expect(classifyRegressionSeverity(current, baseline)).toBe("none");
  });

  test('returns "none" when baseline has no metrics and current passes', () => {
    const current = makeResult({ compositeScore: 0.9, status: "pass" });
    const baseline = makeResult({ compositeScore: 0.9 });
    expect(classifyRegressionSeverity(current, baseline)).toBe("none");
  });

  test('returns "none" when no composite score on either side', () => {
    const current = makeResult({
      compositeScore: undefined,
      metrics: [makeMetric("accuracy", 0.9, true)],
      status: "pass",
    });
    const baseline = makeResult({ compositeScore: undefined });
    expect(classifyRegressionSeverity(current, baseline)).toBe("none");
  });
});

// ---------- detectVersionMismatch ----------

describe("detectVersionMismatch", () => {
  test("returns no mismatch when baseline version is null", () => {
    const result = detectVersionMismatch(null, "v2", "test-scenario");
    expect(result.versionMismatch).toBe(false);
    expect(result.versionMismatchWarning).toBeNull();
  });

  test("returns no mismatch when contender version is null", () => {
    const result = detectVersionMismatch("v1", null, "test-scenario");
    expect(result.versionMismatch).toBe(false);
    expect(result.versionMismatchWarning).toBeNull();
  });

  test("returns no mismatch when both versions are null", () => {
    const result = detectVersionMismatch(null, null, "test-scenario");
    expect(result.versionMismatch).toBe(false);
    expect(result.versionMismatchWarning).toBeNull();
  });

  test("returns no mismatch when versions match", () => {
    const result = detectVersionMismatch("v1", "v1", "test-scenario");
    expect(result.versionMismatch).toBe(false);
    expect(result.versionMismatchWarning).toBeNull();
  });

  test("returns mismatch with warning when versions differ", () => {
    const result = detectVersionMismatch("v1", "v2", "my-scenario");
    expect(result.versionMismatch).toBe(true);
    expect(result.versionMismatchWarning).toContain("my-scenario");
    expect(result.versionMismatchWarning).toContain("v1");
    expect(result.versionMismatchWarning).toContain("v2");
  });

  test("warning includes baseline and contender labels", () => {
    const result = detectVersionMismatch("1.0.0", "2.0.0", "core-agent");
    expect(result.versionMismatchWarning).toContain("baseline=1.0.0");
    expect(result.versionMismatchWarning).toContain("contender=2.0.0");
  });
});

// ---------- createComparisonReport ----------

describe("createComparisonReport", () => {
  test("produces report with correct contender metadata", () => {
    const current = makeResult({ scenarioName: "s1" });
    const snapshot = makeSnapshot(current);

    const report = createComparisonReport({
      contenderFinishedAt: "2026-01-01T01:00:00.000Z",
      contenderModelId: "model-a",
      contenderRunId: "run-001",
      contenderStartedAt: "2026-01-01T00:00:00.000Z",
      scenarios: [{ comparison: compareToBaseline(current, snapshot.result), snapshot }],
    });

    expect(report.contenderRunId).toBe("run-001");
    expect(report.contenderMetadata.modelId).toBe("model-a");
    expect(report.contenderMetadata.runId).toBe("run-001");
    expect(report.contenderMetadata.startedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("produces report with correct baseline metadata scenarios list", () => {
    const current = makeResult({ scenarioName: "s1" });
    const snapshot = makeSnapshot(current);

    const report = createComparisonReport({
      contenderFinishedAt: "2026-01-01T01:00:00.000Z",
      contenderModelId: "model-a",
      contenderRunId: "run-001",
      contenderStartedAt: "2026-01-01T00:00:00.000Z",
      scenarios: [{ comparison: compareToBaseline(current, snapshot.result), snapshot }],
    });

    expect(report.baselineRunId).toBeNull();
    expect(report.baselineMetadata.source).toBe("scenario-baselines");
    expect(report.baselineMetadata.scenarios).toHaveLength(1);
    expect(report.baselineMetadata.scenarios[0]?.scenarioName).toBe("s1");
  });

  test("excludes scenarios with null snapshot from baseline metadata", () => {
    const current = makeResult({ scenarioName: "s-no-baseline" });

    const report = createComparisonReport({
      contenderFinishedAt: "2026-01-01T01:00:00.000Z",
      contenderModelId: "model-a",
      contenderRunId: "run-001",
      contenderStartedAt: "2026-01-01T00:00:00.000Z",
      scenarios: [
        {
          comparison: compareToBaseline(current, null),
          snapshot: null,
        },
      ],
    });

    expect(report.baselineMetadata.scenarios).toHaveLength(0);
    expect(report.scenarios).toHaveLength(1);
    expect(report.scenarios[0]?.baselineScore).toBeNull();
  });

  test("sets versionMismatch correctly in scenario output", () => {
    const baseline = makeResult({ scenarioName: "s1", scenarioVersion: "v1" });
    const current = makeResult({ scenarioName: "s1", scenarioVersion: "v2" });
    const snapshot = makeSnapshot(baseline);

    const report = createComparisonReport({
      contenderFinishedAt: "2026-01-01T01:00:00.000Z",
      contenderModelId: "model-a",
      contenderRunId: "run-001",
      contenderStartedAt: "2026-01-01T00:00:00.000Z",
      scenarios: [{ comparison: compareToBaseline(current, snapshot.result), snapshot }],
    });

    const scenario = report.scenarios[0]!;
    expect(scenario.versionMismatch).toBe(true);
    expect(scenario.versionMismatchWarning).not.toBeNull();
    expect(scenario.scenarioVersion.baseline).toBe("v1");
    expect(scenario.scenarioVersion.contender).toBe("v2");
  });

  test("sets no versionMismatch when versions match", () => {
    const baseline = makeResult({ scenarioName: "s1", scenarioVersion: "v1" });
    const current = makeResult({ scenarioName: "s1", scenarioVersion: "v1" });
    const snapshot = makeSnapshot(baseline);

    const report = createComparisonReport({
      contenderFinishedAt: "2026-01-01T01:00:00.000Z",
      contenderModelId: "model-a",
      contenderRunId: "run-001",
      contenderStartedAt: "2026-01-01T00:00:00.000Z",
      scenarios: [{ comparison: compareToBaseline(current, snapshot.result), snapshot }],
    });

    const scenario = report.scenarios[0]!;
    expect(scenario.versionMismatch).toBe(false);
    expect(scenario.versionMismatchWarning).toBeNull();
  });

  test("sets regressionSeverity based on classifyRegressionSeverity", () => {
    const baseline = makeResult({
      compositeScore: 0.9,
      metrics: [makeMetric("accuracy", 0.9, true)],
      scenarioName: "s1",
    });
    const current = makeResult({
      compositeScore: 0.7,
      metrics: [makeMetric("accuracy", 0.7, true)],
      scenarioName: "s1",
    });
    const snapshot = makeSnapshot(baseline);

    const report = createComparisonReport({
      contenderFinishedAt: "2026-01-01T01:00:00.000Z",
      contenderModelId: "model-a",
      contenderRunId: "run-001",
      contenderStartedAt: "2026-01-01T00:00:00.000Z",
      scenarios: [{ comparison: compareToBaseline(current, snapshot.result), snapshot }],
    });

    expect(report.scenarios[0]?.regressionSeverity).toBe("warning");
  });

  test("sets regressionSeverity critical on failed scenario", () => {
    const baseline = makeResult({ scenarioName: "s1" });
    const current = makeResult({ scenarioName: "s1", status: "fail" });
    const snapshot = makeSnapshot(baseline);

    const report = createComparisonReport({
      contenderFinishedAt: "2026-01-01T01:00:00.000Z",
      contenderModelId: "model-a",
      contenderRunId: "run-001",
      contenderStartedAt: "2026-01-01T00:00:00.000Z",
      scenarios: [{ comparison: compareToBaseline(current, snapshot.result), snapshot }],
    });

    expect(report.scenarios[0]?.regressionSeverity).toBe("critical");
  });

  test("embeds contenderMetadata when provided", () => {
    const current = makeResult({ scenarioName: "s1" });
    const snapshot = makeSnapshot(current);
    const metadata = {
      endTime: "2026-01-01T01:00:00.000Z",
      env: { platform: "linux", runtime: "bun", runtimeVersion: "1.2.3" },
      git: { branch: "main", commit: "abc123", dirty: false },
      startTime: "2026-01-01T00:00:00.000Z",
    };

    const report = createComparisonReport({
      contenderFinishedAt: "2026-01-01T01:00:00.000Z",
      contenderMetadata: metadata,
      contenderModelId: "model-a",
      contenderRunId: "run-001",
      contenderStartedAt: "2026-01-01T00:00:00.000Z",
      scenarios: [{ comparison: compareToBaseline(current, snapshot.result), snapshot }],
    });

    expect(report.contenderMetadata.metadata).toEqual(metadata);
  });

  test("computes delta correctly", () => {
    const baseline = makeResult({ compositeScore: 0.8, scenarioName: "s1" });
    const current = makeResult({ compositeScore: 0.9, scenarioName: "s1" });
    const snapshot = makeSnapshot(baseline);

    const report = createComparisonReport({
      contenderFinishedAt: "2026-01-01T01:00:00.000Z",
      contenderModelId: "model-a",
      contenderRunId: "run-001",
      contenderStartedAt: "2026-01-01T00:00:00.000Z",
      scenarios: [{ comparison: compareToBaseline(current, snapshot.result), snapshot }],
    });

    expect(report.scenarios[0]?.delta).toBeCloseTo(0.1);
  });

  test("delta is null when no baseline", () => {
    const current = makeResult({ compositeScore: 0.9, scenarioName: "s1" });

    const report = createComparisonReport({
      contenderFinishedAt: "2026-01-01T01:00:00.000Z",
      contenderModelId: "model-a",
      contenderRunId: "run-001",
      contenderStartedAt: "2026-01-01T00:00:00.000Z",
      scenarios: [
        {
          comparison: compareToBaseline(current, null),
          snapshot: null,
        },
      ],
    });

    expect(report.scenarios[0]?.delta).toBeNull();
  });

  test("baseline scenarios list is sorted by scenarioName", () => {
    const s1 = makeResult({ scenarioName: "z-scenario" });
    const s2 = makeResult({ scenarioName: "a-scenario" });

    const report = createComparisonReport({
      contenderFinishedAt: "2026-01-01T01:00:00.000Z",
      contenderModelId: "model-a",
      contenderRunId: "run-001",
      contenderStartedAt: "2026-01-01T00:00:00.000Z",
      scenarios: [
        { comparison: compareToBaseline(s1, null), snapshot: makeSnapshot(s1) },
        { comparison: compareToBaseline(s2, null), snapshot: makeSnapshot(s2) },
      ],
    });

    expect(report.baselineMetadata.scenarios[0]?.scenarioName).toBe("a-scenario");
    expect(report.baselineMetadata.scenarios[1]?.scenarioName).toBe("z-scenario");
  });

  test("loads legacy baseline snapshots with normalized fallback fields", async () => {
    const baselinesDir = await createTempDir("benchmark-baselines-");
    cleanupDirs.push(baselinesDir);

    const previous = process.env["BENCHMARK_BASELINES_DIR"];
    process.env["BENCHMARK_BASELINES_DIR"] = baselinesDir;

    try {
      await writeFile(
        join(baselinesDir, "legacy-scenario.baseline.json"),
        JSON.stringify(
          {
            compositeScore: 0.6,
            metrics: [makeMetric("accuracy", 0.6, true, "metric-v2"), { invalid: true }],
            modelId: "top-level-model",
            result: {
              compositeScore: 0.9,
              durationMs: 321,
              errorClass: "provider_instability",
              errorMessage: "transient failure",
              metrics: [makeMetric("ignored", 0.9, true, "metric-v1")],
              modelId: "nested-model",
              retries: 4,
              scenarioName: "nested-name",
              scenarioVersion: "2026.01",
              status: "unexpected-status",
              usage: {
                estimated: false,
                estimatedCostUsd: 1.23,
                inputTokens: 4,
                outputTokens: 5,
                providerMetadata: { source: "bedrock" },
              },
            },
            scenarioName: "legacy-scenario",
          },
          null,
          2
        ),
        "utf8"
      );

      const snapshot = await loadBaseline("legacy-scenario");
      expect(snapshot).not.toBeNull();
      expect(snapshot).toEqual({
        compositeScore: 0.6,
        metrics: [makeMetric("accuracy", 0.6, true, "metric-v2")],
        modelId: "top-level-model",
        result: {
          compositeScore: 0.6,
          durationMs: 321,
          errorClass: "provider_instability",
          errorMessage: "transient failure",
          metrics: [makeMetric("accuracy", 0.6, true, "metric-v2")],
          modelId: "top-level-model",
          retries: 4,
          scenarioName: "legacy-scenario",
          scenarioVersion: "2026.01",
          status: "pass",
          usage: {
            estimated: false,
            estimatedCostUsd: 1.23,
            inputTokens: 4,
            outputTokens: 5,
            providerMetadata: { source: "bedrock" },
          },
        },
        scenarioName: "legacy-scenario",
        timestamp: new Date(0).toISOString(),
      });
    } finally {
      if (previous === undefined) {
        delete process.env["BENCHMARK_BASELINES_DIR"];
      } else {
        process.env["BENCHMARK_BASELINES_DIR"] = previous;
      }
    }
  });

  test("warns on version mismatch and locks report metric schema", async () => {
    const artifactsDir = await createTempDir("benchmark-compare-");
    cleanupDirs.push(artifactsDir);

    const baseline = makeResult({
      compositeScore: 0.92,
      metrics: [
        makeMetric("accuracy", 0.92, true, "score-v1"),
        makeMetric("recall", 0.8, true, "score-v1"),
      ],
      modelId: "baseline-model",
      scenarioName: "schema-scenario",
      scenarioVersion: "v1",
    });
    const current = makeResult({
      compositeScore: 0.88,
      metrics: [
        makeMetric("accuracy", 0.88, true, "score-v2"),
        makeMetric("precision", 0.9, true, "score-v2"),
      ],
      modelId: "contender-model",
      scenarioName: "schema-scenario",
      scenarioVersion: "v2",
    });
    const snapshot = makeSnapshot(baseline);
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };

    try {
      const report = createComparisonReport({
        contenderFinishedAt: "2026-01-01T01:00:00.000Z",
        contenderModelId: "contender-model",
        contenderRunId: "run-123",
        contenderStartedAt: "2026-01-01T00:00:00.000Z",
        scenarios: [{ comparison: compareToBaseline(current, baseline), snapshot }],
      });

      expect(warnings).toEqual([
        '[benchmark] Scenario version mismatch for "schema-scenario": baseline=v1, contender=v2',
      ]);
      expect(Object.keys(report).sort()).toEqual([
        "baselineMetadata",
        "baselineRunId",
        "contenderMetadata",
        "contenderRunId",
        "scenarios",
        "timestamp",
      ]);
      expect(Object.keys(report.scenarios[0]!).sort()).toEqual([
        "baselineModelId",
        "baselineScore",
        "baselineStatus",
        "baselineTimestamp",
        "contenderModelId",
        "contenderScore",
        "contenderStatus",
        "delta",
        "metrics",
        "regressionSeverity",
        "scenarioName",
        "scenarioVersion",
        "versionMismatch",
        "versionMismatchWarning",
      ]);
      expect(report.scenarios[0]?.metrics).toEqual([
        {
          baselinePassed: true,
          baselineScore: 0.92,
          baselineScorerVersion: "score-v1",
          contenderPassed: true,
          contenderScore: 0.88,
          contenderScorerVersion: "score-v2",
          delta: -0.040000000000000036,
          name: "accuracy",
        },
        {
          baselinePassed: null,
          baselineScore: null,
          baselineScorerVersion: undefined,
          contenderPassed: true,
          contenderScore: 0.9,
          contenderScorerVersion: "score-v2",
          delta: null,
          name: "precision",
        },
        {
          baselinePassed: true,
          baselineScore: 0.8,
          baselineScorerVersion: "score-v1",
          contenderPassed: null,
          contenderScore: null,
          contenderScorerVersion: undefined,
          delta: null,
          name: "recall",
        },
      ]);

      const reportPath = await writeComparisonReport(artifactsDir, report);
      const persisted = JSON.parse(await readFile(reportPath, "utf8"));
      expect(persisted).toEqual(JSON.parse(JSON.stringify(report)));
    } finally {
      console.warn = originalWarn;
    }
  });
});
