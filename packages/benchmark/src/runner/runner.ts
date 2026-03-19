import { getRunsBaseDir } from "../artifacts/storage";
import type { BenchmarkRun, RunSpec, Suite } from "../types";
import { buildBenchmarkRun, finalizeRunArtifacts } from "./artifacts";
import type { BenchmarkContext } from "./context";
import { executeScenario } from "./execution";
import { createSuiteState } from "./state";
import type { BenchmarkRunOptions } from "./types";

export type { BenchmarkRunOptions } from "./types";

export async function runBenchmarkSuite<TCtx extends BenchmarkContext = BenchmarkContext>(
  suite: Suite<TCtx>,
  spec: RunSpec,
  options?: BenchmarkRunOptions<TCtx>
): Promise<BenchmarkRun> {
  const state = createSuiteState(spec);
  const artifactBaseDir = spec.artifactBaseDir ?? getRunsBaseDir();
  let suiteError: unknown;

  try {
    for (const scenario of suite.scenarios) {
      await executeScenario(state, suite, scenario, spec, options);
    }
  } catch (error) {
    suiteError = error;
  }

  state.finishedAt = new Date();
  const { runDir, summary } = await finalizeRunArtifacts({
    abortReason: state.abortReason,
    artifactBaseDir,
    finishedAt: state.finishedAt,
    modelId: spec.modelId,
    results: state.results,
    runId: state.runId,
    startedAt: state.startedAt,
    suiteError,
  });

  if (suiteError) {
    throw suiteError;
  }

  return buildBenchmarkRun({
    finishedAt: state.finishedAt,
    results: state.results,
    runDir,
    runId: state.runId,
    spec,
    startedAt: state.startedAt,
    suiteName: suite.name,
    summary,
  });
}
