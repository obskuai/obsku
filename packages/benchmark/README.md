# @obsku/benchmark

Internal benchmark platform for @obsku/framework

## Status

Private internal package, not published.

## Quick Start

```bash
bun packages/benchmark/src/cli.ts --model <bedrock-model-id>
```

Runs real-LLM benchmark scenarios against a Bedrock model, writes run artifacts, and can compare results against saved baselines.

## CLI Options

| Option | Purpose |
| --- | --- |
| `--model <id>` | Required Bedrock model ID to benchmark. |
| `--scenario <name>` | Run one scenario only: `core-agent`, `checkpoint-resume`, or `compaction`. |
| `--save-baseline` | Save passing results as new baselines after the run. |
| `--compare-to` | Compare the run against existing baselines and report regressions. |

## Scenarios

- `core-agent`: checks basic agent execution, tool pairing, usage tracking, and output quality.
- `checkpoint-resume`: checks interrupt, resume, checkpoint events, and persisted session state.
- `compaction`: checks context compaction behavior, token savings, and recall after compression.

## Internal Structure

- `src/cli.ts`: CLI entrypoint and suite wiring.
- `src/baseline/`: baseline loading plus comparison decode, diff, and report generation.
- `src/runner/`: execution, policy, artifacts, state, and suite orchestration.
- `src/scenarios/`: scenario definitions for `core-agent`, `checkpoint-resume`, and `compaction`.
- `src/artifacts/`: run storage, schemas, and artifact writers.

Key baseline files:
- `compare-decode.ts`
- `compare-diff.ts`
- `compare-report.ts`

Key runner files:
- `execution.ts`
- `policy.ts`
- `artifacts.ts`
- `state.ts`

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `AWS_REGION` | AWS region for Bedrock calls. |
| `BENCHMARK_MAX_COST_USD` | Max run budget in USD. |
| `BENCHMARK_RUNS_DIR` | Directory for benchmark run artifacts. |
| `BENCHMARK_BASELINES_DIR` | Directory for saved baselines. |
