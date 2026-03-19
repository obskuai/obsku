import { isRecord } from "@obsku/framework";
import type { MetricResult, ScenarioResult, ScenarioStatus } from "../types";
import type { BaselineSnapshot } from "./compare-types";

function isScenarioStatus(value: unknown): value is ScenarioStatus {
  return value === "pass" || value === "fail" || value === "error" || value === "skipped";
}

function normalizeMetric(metric: unknown): MetricResult | null {
  if (!isRecord(metric)) return null;
  if (typeof metric["name"] !== "string") return null;
  if (typeof metric["score"] !== "number") return null;
  if (!isRecord(metric["toleranceBand"])) return null;
  if (typeof metric["toleranceBand"]["min"] !== "number") return null;
  if (typeof metric["toleranceBand"]["max"] !== "number") return null;
  if (typeof metric["passed"] !== "boolean") return null;
  if (typeof metric["weight"] !== "number") return null;

  return {
    name: metric["name"],
    note: typeof metric["note"] === "string" ? metric["note"] : undefined,
    passed: metric["passed"],
    score: metric["score"],
    scorerVersion:
      typeof metric["scorerVersion"] === "string" ? metric["scorerVersion"] : undefined,
    toleranceBand: {
      max: metric["toleranceBand"]["max"],
      min: metric["toleranceBand"]["min"],
    },
    weight: metric["weight"],
  } satisfies MetricResult;
}

function normalizeMetrics(value: unknown): MetricResult[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((metric) => normalizeMetric(metric))
    .filter((metric): metric is MetricResult => metric !== null);
}

function buildFallbackScenarioResult(record: Record<string, unknown>): ScenarioResult | null {
  if (typeof record["scenarioName"] !== "string") return null;
  if (typeof record["modelId"] !== "string") return null;

  const status = isScenarioStatus(record["status"]) ? record["status"] : "pass";
  const metrics = normalizeMetrics(record["metrics"]);
  const compositeScore =
    typeof record["compositeScore"] === "number" ? record["compositeScore"] : undefined;

  return {
    compositeScore,
    durationMs: typeof record["durationMs"] === "number" ? record["durationMs"] : 0,
    errorClass:
      record["errorClass"] === "framework_regression" ||
      record["errorClass"] === "provider_instability" ||
      record["errorClass"] === "unknown"
        ? record["errorClass"]
        : undefined,
    errorMessage: typeof record["errorMessage"] === "string" ? record["errorMessage"] : undefined,
    errorStack: typeof record["errorStack"] === "string" ? record["errorStack"] : undefined,
    metrics: metrics.length > 0 ? metrics : undefined,
    modelId: record["modelId"],
    retries: typeof record["retries"] === "number" ? record["retries"] : 0,
    scenarioName: record["scenarioName"],
    scenarioVersion:
      typeof record["scenarioVersion"] === "string" ? record["scenarioVersion"] : undefined,
    status,
    usage: isRecord(record["usage"])
      ? {
          estimated:
            typeof record["usage"]["estimated"] === "boolean"
              ? record["usage"]["estimated"]
              : undefined,
          estimatedCostUsd:
            typeof record["usage"]["estimatedCostUsd"] === "number"
              ? record["usage"]["estimatedCostUsd"]
              : 0,
          inputTokens:
            typeof record["usage"]["inputTokens"] === "number" ? record["usage"]["inputTokens"] : 0,
          outputTokens:
            typeof record["usage"]["outputTokens"] === "number"
              ? record["usage"]["outputTokens"]
              : 0,
          providerMetadata: isRecord(record["usage"]["providerMetadata"])
            ? record["usage"]["providerMetadata"]
            : undefined,
        }
      : undefined,
  } satisfies ScenarioResult;
}

function normalizeScenarioResult(value: unknown): ScenarioResult | null {
  if (!isRecord(value)) return null;
  return buildFallbackScenarioResult(value);
}

export function toBaselineSnapshot(value: unknown): BaselineSnapshot | null {
  if (!isRecord(value)) return null;

  const nestedResult = normalizeScenarioResult(value["result"]);
  const fallbackResult = buildFallbackScenarioResult(value);
  const result = nestedResult ?? fallbackResult;
  if (!result) return null;

  return {
    compositeScore:
      typeof value["compositeScore"] === "number"
        ? value["compositeScore"]
        : (result.compositeScore ?? 0),
    metrics: normalizeMetrics(value["metrics"] ?? result.metrics),
    modelId: typeof value["modelId"] === "string" ? value["modelId"] : result.modelId,
    result: {
      ...result,
      compositeScore:
        typeof value["compositeScore"] === "number"
          ? value["compositeScore"]
          : (result.compositeScore ?? undefined),
      metrics: normalizeMetrics(value["metrics"] ?? result.metrics),
      modelId: typeof value["modelId"] === "string" ? value["modelId"] : result.modelId,
      scenarioName:
        typeof value["scenarioName"] === "string" ? value["scenarioName"] : result.scenarioName,
    },
    scenarioName:
      typeof value["scenarioName"] === "string" ? value["scenarioName"] : result.scenarioName,
    timestamp:
      typeof value["timestamp"] === "string" ? value["timestamp"] : new Date(0).toISOString(),
  } satisfies BaselineSnapshot;
}

export function buildSnapshot(
  scenarioName: string,
  scenarioResult: ScenarioResult
): BaselineSnapshot {
  const metrics = scenarioResult.metrics ?? [];
  const compositeScore = scenarioResult.compositeScore ?? 0;

  return {
    compositeScore,
    metrics,
    modelId: scenarioResult.modelId,
    result: {
      ...scenarioResult,
      compositeScore,
      metrics,
      scenarioName,
    },
    scenarioName,
    timestamp: new Date().toISOString(),
  } satisfies BaselineSnapshot;
}
