import { getRunsBaseDir } from "../artifacts/storage";
import type {
  ErrorClass,
  RunSpec,
  Scenario,
  ScenarioResult,
  ScenarioStatus,
  Suite,
} from "../types";
import { writeScenarioArtifacts, writeSkippedScenarioResult } from "./artifacts";
import { BenchmarkContext, cleanupScenarioIsolation, createBenchmarkContext } from "./context";
import {
  applyInterScenarioDelay,
  buildMetricResults,
  checkSuiteBudget,
  classifyError,
  DEFAULT_GLOBAL_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAYS_MS,
  errorMessage,
  errorStack,
  isRetryEligible,
  usageFromEvents,
  waitForRetryDelay,
  withScenarioTimeout,
} from "./policy";
import type { BenchmarkRunOptions, SuiteState } from "./types";

function buildSkippedResult(scenario: Scenario<BenchmarkContext>, modelId: string): ScenarioResult {
  return {
    durationMs: 0,
    modelId,
    retries: 0,
    scenarioName: scenario.name,
    scenarioVersion: scenario.version,
    status: "skipped",
  };
}

export async function executeScenario<TCtx extends BenchmarkContext>(
  state: SuiteState,
  suite: Suite<TCtx>,
  scenario: Scenario<TCtx>,
  spec: RunSpec,
  options?: BenchmarkRunOptions<TCtx>
): Promise<void> {
  const artifactBaseDir = spec.artifactBaseDir ?? getRunsBaseDir();

  if (state.abortReason) {
    const result = buildSkippedResult(scenario as Scenario<BenchmarkContext>, spec.modelId);
    state.results.push(result);
    await writeSkippedScenarioResult(artifactBaseDir, state.runId, result, scenario.name);
    return;
  }

  await applyInterScenarioDelay(state, suite as Suite<unknown>);

  if (
    checkSuiteBudget(state, spec.budgetUsd, options?.globalTimeoutMs ?? DEFAULT_GLOBAL_TIMEOUT_MS)
  ) {
    const result = buildSkippedResult(scenario as Scenario<BenchmarkContext>, spec.modelId);
    state.results.push(result);
    await writeSkippedScenarioResult(artifactBaseDir, state.runId, result, scenario.name);
    return;
  }

  const baseContext = await createBenchmarkContext({
    artifactBaseDir,
    runId: state.runId,
    scenarioName: scenario.name,
    spec,
  });
  const context = options?.createContext
    ? await options.createContext({ baseContext, scenario, spec, suite })
    : (baseContext as TCtx);

  const timeoutMs = scenario.timeoutMs ?? suite.config?.timeoutMs ?? spec.timeoutMs;
  const retryDelaysMs = options?.retryDelaysMs ?? [...DEFAULT_RETRY_DELAYS_MS];
  const maxRetries = options?.maxRetries ?? spec.maxRetries ?? DEFAULT_MAX_RETRIES;
  const startedAt = Date.now();
  let retries = 0;
  let finalError: unknown;
  let finalClass: ErrorClass | undefined;
  let status: ScenarioStatus = "pass";

  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await withScenarioTimeout(timeoutMs, async () => {
          await scenario.run(context);
        });
        finalError = undefined;
        finalClass = undefined;
        status = "pass";
        break;
      } catch (error) {
        finalError = error;
        finalClass = classifyError(error);
        retries = attempt;

        if (!isRetryEligible(error) || attempt >= maxRetries) {
          status = finalClass === "provider_instability" ? "fail" : "error";
          break;
        }

        retries = attempt + 1;
        await waitForRetryDelay(retryDelaysMs, attempt);
      }
    }

    const usage = usageFromEvents(baseContext.getEvents());
    state.totalCostUsd += usage.estimatedCostUsd;
    const metricPayload = buildMetricResults(
      scenario as Scenario<unknown>,
      status,
      spec.defaultTolerance
    );
    const result: ScenarioResult = {
      durationMs: Date.now() - startedAt,
      modelId: spec.modelId,
      retries,
      scenarioName: scenario.name,
      scenarioVersion: scenario.version,
      status,
      usage,
      ...metricPayload,
      ...(finalClass ? { errorClass: finalClass } : {}),
      ...(finalError ? { errorMessage: errorMessage(finalError) } : {}),
      ...(finalError ? { errorStack: errorStack(finalError) } : {}),
    };

    await writeScenarioArtifacts(baseContext, result, scenario.name);

    state.results.push(result);
    state.lastScenarioEndedAt = Date.now();
    checkSuiteBudget(state, spec.budgetUsd, options?.globalTimeoutMs ?? DEFAULT_GLOBAL_TIMEOUT_MS);

    if (finalClass === "framework_regression" && finalError) {
      throw finalError;
    }
  } finally {
    await cleanupScenarioIsolation(baseContext);
  }
}
