import type { CanonicalAgentEvent } from "@obsku/framework";
import { classifyError, isRetryEligible, toErrorRecord } from "@obsku/framework/internal";
import { buildUsage } from "../artifacts/writers";
import type {
  MetricResult,
  Scenario,
  ScenarioStatus,
  ScenarioUsage,
  Suite,
  SuiteSummary,
  ToleranceConfig,
} from "../types";
import { BenchmarkProviderTimeoutError } from "./context";
import type { SuiteState } from "./types";

export const DEFAULT_GLOBAL_TIMEOUT_MS = 300_000;
export const DEFAULT_INTER_SCENARIO_DELAY_MS = 3_000;
export const DEFAULT_RETRY_DELAYS_MS = [5_000, 10_000] as const;
export const DEFAULT_MAX_RETRIES = 2;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function usageFromEvents(events: ReadonlyArray<CanonicalAgentEvent>): ScenarioUsage {
  const lastComplete = [...events].reverse().find((event) => event.type === "agent.complete") as
    | { usage?: { totalInputTokens?: number; totalOutputTokens?: number } }
    | undefined;

  return buildUsage(
    lastComplete?.usage?.totalInputTokens ?? 0,
    lastComplete?.usage?.totalOutputTokens ?? 0
  );
}

export async function withScenarioTimeout<T>(timeoutMs: number, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      run(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new BenchmarkProviderTimeoutError(`scenario exceeded timeout (${timeoutMs}ms)`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Re-export for backward compatibility - now from centralized error-utils
export { toErrorRecord } from "@obsku/framework/internal";

// Re-export for backward compatibility - now from centralized error-utils
export { classifyError } from "@obsku/framework/internal";

// Re-export for backward compatibility - now from centralized error-utils
export { isRetryEligible } from "@obsku/framework/internal";

// Re-export for backward compatibility - now from centralized error-utils
export {
  getErrorMessage as errorMessage,
  getErrorStack as errorStack,
} from "@obsku/framework/internal";

function resolveTolerance(
  tolerance: ToleranceConfig | undefined,
  defaultTolerance: ToleranceConfig | undefined,
  fallbackScore: number
): ToleranceConfig {
  return tolerance ?? defaultTolerance ?? { max: fallbackScore, min: fallbackScore };
}

export function buildMetricResults(
  scenario: Scenario<unknown>,
  status: ScenarioStatus,
  defaultTolerance?: ToleranceConfig
): { compositeScore?: number; metrics?: MetricResult[] } {
  if (!scenario.scoringCriteria?.length || status === "skipped") {
    return {};
  }

  const score = status === "pass" ? 1 : 0;
  const metrics = scenario.scoringCriteria.map((criterion) => {
    const toleranceBand = resolveTolerance(criterion.tolerance, defaultTolerance, score);
    const passed = score >= toleranceBand.min && score <= toleranceBand.max;
    return {
      name: criterion.name,
      note: status === "pass" ? "runner default pass metric" : `runner default ${status} metric`,
      passed,
      score,
      toleranceBand,
      weight: criterion.weight,
      ...(criterion.scorerVersion ? { scorerVersion: criterion.scorerVersion } : {}),
    } satisfies MetricResult;
  });

  const totalWeight = metrics.reduce((sum, metric) => sum + metric.weight, 0);
  const compositeScore =
    totalWeight > 0
      ? metrics.reduce((sum, metric) => sum + metric.score * metric.weight, 0) / totalWeight
      : undefined;

  return { compositeScore, metrics };
}

export async function applyInterScenarioDelay(
  state: SuiteState,
  suite: Suite<unknown>
): Promise<void> {
  if (!state.lastScenarioEndedAt) return;
  const delayMs = suite.config?.interScenarioDelayMs ?? DEFAULT_INTER_SCENARIO_DELAY_MS;
  const elapsed = Date.now() - state.lastScenarioEndedAt;
  const remaining = delayMs - elapsed;
  if (remaining > 0) {
    await delay(remaining);
  }
}

export function checkSuiteBudget(
  state: SuiteState,
  budgetUsd: number,
  globalTimeoutMs: number
): SuiteSummary["abortReason"] | undefined {
  if (state.totalCostUsd > budgetUsd) {
    state.abortReason = "budget_exceeded";
  }

  if (Date.now() - state.startedAt.getTime() > globalTimeoutMs) {
    state.abortReason = "wall_clock_exceeded";
  }

  return state.abortReason;
}

export async function waitForRetryDelay(retryDelaysMs: number[], attempt: number): Promise<void> {
  await delay(retryDelaysMs[attempt] ?? retryDelaysMs[retryDelaysMs.length - 1] ?? 0);
}
