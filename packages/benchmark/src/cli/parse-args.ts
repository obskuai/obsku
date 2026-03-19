/**
 * @obsku/benchmark CLI argument parsing
 */

import type { BenchmarkContext } from "../runner/index";
import {
  agentFactoryScenario,
  checkpointResumeScenario,
  compactionScenario,
  coreAgentScenario,
  crewScenario,
  graphCycleScenario,
  graphParallelScenario,
  guardrailsScenario,
  memoryScenario,
  providerHooksScenario,
  structuredOutputScenario,
  supervisorScenario,
  toolMiddlewareScenario,
} from "../scenarios/index";
import type { Scenario } from "../types/index";

export const ALL_SCENARIOS: Array<Scenario<BenchmarkContext>> = [
  agentFactoryScenario,
  checkpointResumeScenario,
  compactionScenario,
  coreAgentScenario,
  crewScenario,
  graphCycleScenario,
  graphParallelScenario,
  guardrailsScenario,
  memoryScenario,
  providerHooksScenario,
  structuredOutputScenario,
  supervisorScenario,
  toolMiddlewareScenario,
];

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_BUDGET_USD = 2.0;
export const DEFAULT_MAX_RETRIES = 2;

export interface CliArgs {
  model: string | undefined;
  scenario: string | undefined;
  saveBaseline: boolean;
  compareTo: boolean;
  help: boolean;
}

export function showHelp(): void {
  const names = ALL_SCENARIOS.map((s) => s.name).join(" | ");
  console.log(
    `bench - Run @obsku/benchmark scenarios

Usage:
  bun packages/benchmark/src/cli.ts --model <id> [options]

Required:
  --model <id>          Bedrock model ID (e.g. amazon.nova-lite-v1:0)

Optional:
  --scenario <name>     Run only one scenario (${names})
  --save-baseline       Save passing results as new baselines after run
  --compare-to          Compare results against existing baselines
  --help, -h            Show this help

Environment:
  AWS_REGION                  AWS region (default: us-east-1)
  BENCHMARK_MAX_COST_USD      Max spend in USD (default: ${DEFAULT_BUDGET_USD})
  BENCHMARK_RUNS_DIR          Artifact output dir (default: .benchmark-runs)
  BENCHMARK_BASELINES_DIR     Baseline storage dir (default: .benchmark-baselines)

Exit codes:
  0  All scenarios passed (and no baseline regressions when --compare-to is set)
  1  One or more scenarios failed, errored, or aborted
`
  );
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const result: CliArgs = {
    compareTo: false,
    help: false,
    model: undefined,
    saveBaseline: false,
    scenario: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--model") {
      result.model = args[++i];
    } else if (arg === "--scenario") {
      result.scenario = args[++i];
    } else if (arg === "--save-baseline") {
      result.saveBaseline = true;
    } else if (arg === "--compare-to") {
      result.compareTo = true;
    } else if (arg.startsWith("--model=")) {
      result.model = arg.slice("--model=".length);
    } else if (arg.startsWith("--scenario=")) {
      result.scenario = arg.slice("--scenario=".length);
    } else {
      console.error(`Unknown argument: ${arg}`);
      console.error("Run with --help for usage.");
      process.exit(1);
    }
  }

  return result;
}
