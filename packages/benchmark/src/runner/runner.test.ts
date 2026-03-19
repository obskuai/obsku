import { afterAll, describe, expect, test } from "bun:test";
import { access, mkdtemp, readFile, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalAgentEvent } from "@obsku/framework";
import type { Suite } from "../types";
import { type BenchmarkContext, providerInstability } from "./context";
import { runBenchmarkSuite } from "./runner";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

describe("runBenchmarkSuite", () => {
  const cleanupDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(cleanupDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  });

  test("retries provider instability and records subscribed events", async () => {
    const artifactBaseDir = await createTempDir("benchmark-runner-");
    cleanupDirs.push(artifactBaseDir);

    let attempts = 0;
    let frameworkSessionId: string | undefined;
    let subscribedSessionId: string | undefined;
    let capturedEvents: CanonicalAgentEvent[] = [];

    const suite: Suite<BenchmarkContext> = {
      name: "smoke-suite",
      scenarios: [
        {
          name: "smoke-scenario",
          version: "v1",
          async run(ctx) {
            attempts += 1;
            frameworkSessionId = ctx.frameworkSessionId;

            if (attempts === 1) {
              throw providerInstability("transient throttle");
            }

            const subject = {
              async subscribe(options?: { sessionId?: string }) {
                subscribedSessionId = options?.sessionId;

                async function* stream(): AsyncIterable<CanonicalAgentEvent> {
                  yield {
                    sessionId: options?.sessionId ?? "session",
                    timestamp: Date.now(),
                    type: "session.start",
                  } as CanonicalAgentEvent;
                  yield {
                    timestamp: Date.now(),
                    type: "agent.complete",
                    usage: { totalInputTokens: 11, totalOutputTokens: 7 },
                  } as CanonicalAgentEvent;
                  yield {
                    sessionId: options?.sessionId ?? "session",
                    status: "complete",
                    timestamp: Date.now(),
                    type: "session.end",
                  } as CanonicalAgentEvent;
                }

                return stream();
              },
            };

            const collected = await ctx.collectAgentEvents(subject, async (sessionId) => {
              expect(sessionId).toBe(ctx.frameworkSessionId);
              return "ok";
            });
            capturedEvents = collected.events;
          },
        },
      ],
    };

    const run = await runBenchmarkSuite(
      suite,
      {
        artifactBaseDir,
        budgetUsd: 1,
        modelId: "amazon.nova-lite-v1:0",
        timeoutMs: 10_000,
      },
      {
        retryDelaysMs: [1, 1],
      }
    );

    expect(attempts).toBe(2);
    expect(subscribedSessionId).toBe(frameworkSessionId);
    expect(run.summary.passed).toBe(1);
    expect(run.summary.failed).toBe(0);
    expect(run.summary.skipped).toBe(0);

    const [result] = run.scenarioResults;
    expect(result?.status).toBe("pass");
    expect(result?.retries).toBe(1);
    expect(result?.usage?.inputTokens).toBe(11);
    expect(result?.usage?.outputTokens).toBe(7);
    expect(capturedEvents.map((event) => event.type)).toEqual([
      "session.start",
      "agent.complete",
      "session.end",
    ]);

    const resultJson = JSON.parse(
      await readFile(join(run.artifactsPath, "smoke-scenario", "result.json"), "utf8")
    ) as { status: string };
    expect(resultJson.status).toBe("pass");
  });

  test("SuiteSummary includes RunMetadata with git and env fields", async () => {
    const artifactBaseDir = await createTempDir("benchmark-runner-meta-");
    cleanupDirs.push(artifactBaseDir);

    const suite: Suite<BenchmarkContext> = {
      name: "meta-suite",
      scenarios: [
        {
          name: "meta-scenario",
          version: "v1",
          async run(_ctx) {
            // no-op — just verifies metadata collection happens
          },
        },
      ],
    };

    const run = await runBenchmarkSuite(
      suite,
      {
        artifactBaseDir,
        budgetUsd: 1,
        modelId: "amazon.nova-lite-v1:0",
        timeoutMs: 10_000,
      },
      { retryDelaysMs: [1] }
    );

    const { metadata } = run.summary;
    expect(metadata).toBeDefined();
    expect(typeof metadata?.git.commit).toBe("string");
    expect(typeof metadata?.git.branch).toBe("string");
    expect(typeof metadata?.git.dirty).toBe("boolean");
    expect(metadata?.env.runtime).toMatch(/^(bun|node)$/);
    expect(typeof metadata?.env.runtimeVersion).toBe("string");
    expect(typeof metadata?.env.platform).toBe("string");
    expect(typeof metadata?.startTime).toBe("string");
    expect(typeof metadata?.endTime).toBe("string");
    // startTime <= endTime
    expect(new Date(metadata!.startTime).getTime()).toBeLessThanOrEqual(
      new Date(metadata!.endTime).getTime()
    );
  });

  test("SuiteSummary metadata is persisted in suite-summary.json artifact", async () => {
    const artifactBaseDir = await createTempDir("benchmark-runner-persist-");
    cleanupDirs.push(artifactBaseDir);

    const suite: Suite<BenchmarkContext> = {
      name: "persist-suite",
      scenarios: [
        {
          name: "persist-scenario",
          version: "v1",
          async run(_ctx) {
            // no-op
          },
        },
      ],
    };

    const run = await runBenchmarkSuite(
      suite,
      {
        artifactBaseDir,
        budgetUsd: 1,
        modelId: "amazon.nova-lite-v1:0",
        timeoutMs: 10_000,
      },
      { retryDelaysMs: [1] }
    );

    const summaryJson = JSON.parse(
      await readFile(join(run.artifactsPath, "suite-summary.json"), "utf8")
    ) as { metadata?: { git: unknown; env: unknown } };
    expect(summaryJson.metadata).toBeDefined();
    expect(summaryJson.metadata?.git).toBeDefined();
    expect(summaryJson.metadata?.env).toBeDefined();
  });

  test("times out as framework error, skips retry, and persists artifacts before rethrow", async () => {
    const artifactBaseDir = await createTempDir("benchmark-runner-timeout-");
    cleanupDirs.push(artifactBaseDir);

    let attempts = 0;

    const suite: Suite<BenchmarkContext> = {
      name: "timeout-suite",
      scenarios: [
        {
          name: "timeout-scenario",
          timeoutMs: 5,
          version: "v1",
          async run() {
            attempts += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
          },
        },
      ],
    };

    expect(
      runBenchmarkSuite(
        suite,
        {
          artifactBaseDir,
          budgetUsd: 1,
          modelId: "amazon.nova-lite-v1:0",
          timeoutMs: 10_000,
        },
        {
          maxRetries: 1,
          retryDelaysMs: [1],
        }
      )
    ).rejects.toThrow("scenario exceeded timeout (5ms)");

    expect(attempts).toBe(1);

    const indexJson = await readJson<{
      runs: Array<{
        failed: number;
        modelId: string;
        passed: number;
        runId: string;
        totalScenarios: number;
      }>;
    }>(join(artifactBaseDir, "index.json"));
    expect(indexJson.runs).toHaveLength(1);

    const failedRunId = indexJson.runs[0]?.runId;
    expect(indexJson.runs[0]).toMatchObject({
      failed: 1,
      modelId: "amazon.nova-lite-v1:0",
      passed: 0,
      runId: failedRunId,
      totalScenarios: 1,
    });

    const summaryJson = await readJson<{
      failed: number;
      passed: number;
      providerInstability: number;
      skipped: number;
      totalScenarios: number;
    }>(join(artifactBaseDir, failedRunId!, "suite-summary.json"));
    expect(summaryJson).toMatchObject({
      failed: 1,
      passed: 0,
      providerInstability: 0,
      skipped: 0,
      totalScenarios: 1,
    });

    const scenarioDir = join(artifactBaseDir, failedRunId!, "timeout-scenario");
    const resultJson = await readJson<{
      errorClass: string;
      errorMessage: string;
      retries: number;
      status: string;
    }>(join(scenarioDir, "result.json"));
    expect(resultJson).toMatchObject({
      errorClass: "framework_regression",
      errorMessage: "scenario exceeded timeout (5ms)",
      retries: 0,
      status: "error",
    });

    const usageJson = await readJson<{
      estimated: boolean;
      estimatedCostUsd: number;
      inputTokens: number;
      outputTokens: number;
    }>(join(scenarioDir, "usage.json"));
    expect(usageJson).toEqual({
      estimated: true,
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    });

    const trace = await readFile(join(scenarioDir, "trace.txt"), "utf8");
    expect(trace).toContain("SCENARIO: timeout-scenario");
    expect(trace).toContain("EVENTS:   0 total");
    expect(access(join(artifactBaseDir, "latest"))).rejects.toBeDefined();
  });

  test("aborts on budget, skips later scenarios, writes run index and latest link", async () => {
    const artifactBaseDir = await createTempDir("benchmark-runner-budget-");
    cleanupDirs.push(artifactBaseDir);

    const suite: Suite<BenchmarkContext> = {
      name: "budget-suite",
      scenarios: [
        {
          name: "priced-scenario",
          scoringCriteria: [
            {
              name: "success",
              tolerance: { max: 1, min: 1 },
              weight: 1,
            },
          ],
          version: "v1",
          async run(ctx) {
            await ctx.recordEvent({
              timestamp: Date.now(),
              type: "agent.complete",
              usage: { totalInputTokens: 20_000_000, totalOutputTokens: 20_000_000 },
            } as CanonicalAgentEvent);
          },
        },
        {
          name: "skipped-scenario",
          version: "v2",
          async run() {
            throw new Error("should not execute");
          },
        },
      ],
    };

    const run = await runBenchmarkSuite(
      suite,
      {
        artifactBaseDir,
        budgetUsd: 1,
        modelId: "amazon.nova-lite-v1:0",
        timeoutMs: 10_000,
      },
      { retryDelaysMs: [1] }
    );

    expect(
      run.scenarioResults.map((result) => ({
        compositeScore: result.compositeScore,
        retries: result.retries,
        scenarioName: result.scenarioName,
        scenarioVersion: result.scenarioVersion,
        status: result.status,
      }))
    ).toEqual([
      {
        compositeScore: 1,
        retries: 0,
        scenarioName: "priced-scenario",
        scenarioVersion: "v1",
        status: "pass",
      },
      {
        compositeScore: undefined,
        retries: 0,
        scenarioName: "skipped-scenario",
        scenarioVersion: "v2",
        status: "skipped",
      },
    ]);
    expect(run.summary.abortReason).toBe("budget_exceeded");
    expect(run.summary.skipped).toBe(1);
    expect(run.summary.passed).toBe(1);
    expect(run.summary.failed).toBe(1);
    expect(run.summary.providerInstability).toBe(0);
    expect(run.summary.totalScenarios).toBe(2);
    expect(run.summary.avgCompositeScore).toBe(1);
    expect(run.summary.totalCostUsd).toBeCloseTo(1.2);

    const skippedDir = join(run.artifactsPath, "skipped-scenario");
    const skippedResult = await readJson<{ status: string; scenarioVersion: string }>(
      join(skippedDir, "result.json")
    );
    expect(skippedResult).toMatchObject({ scenarioVersion: "v2", status: "skipped" });
    expect(access(join(skippedDir, "usage.json"))).rejects.toBeDefined();
    expect(access(join(skippedDir, "trace.txt"))).rejects.toBeDefined();

    const summaryJson = await readJson<{
      abortReason: string;
      avgCompositeScore: number;
      failed: number;
      passed: number;
      providerInstability: number;
      skipped: number;
      totalCostUsd: number;
      totalScenarios: number;
    }>(join(run.artifactsPath, "suite-summary.json"));
    expect(summaryJson).toMatchObject({
      abortReason: "budget_exceeded",
      avgCompositeScore: 1,
      failed: 1,
      passed: 1,
      providerInstability: 0,
      skipped: 1,
      totalCostUsd: 1.2000000000000002,
      totalScenarios: 2,
    });

    const indexJson = await readJson<{
      runs: Array<{
        avgCompositeScore?: number;
        failed: number;
        modelId: string;
        passed: number;
        runId: string;
        totalScenarios: number;
      }>;
    }>(join(artifactBaseDir, "index.json"));
    expect(indexJson.runs).toHaveLength(1);
    expect(indexJson.runs[0]).toMatchObject({
      avgCompositeScore: 1,
      failed: 1,
      modelId: "amazon.nova-lite-v1:0",
      passed: 1,
      runId: run.runId,
      totalScenarios: 2,
    });

    expect(await readlink(join(artifactBaseDir, "latest"))).toBe(run.runId);
  });

  test("persists summary on framework error, rethrows, and does not advance latest", async () => {
    const artifactBaseDir = await createTempDir("benchmark-runner-framework-");
    cleanupDirs.push(artifactBaseDir);

    const passingSuite: Suite<BenchmarkContext> = {
      name: "framework-suite",
      scenarios: [
        {
          name: "baseline-pass",
          version: "v1",
          async run() {},
        },
      ],
    };

    const firstRun = await runBenchmarkSuite(
      passingSuite,
      {
        artifactBaseDir,
        budgetUsd: 1,
        modelId: "amazon.nova-lite-v1:0",
        timeoutMs: 10_000,
      },
      { retryDelaysMs: [1] }
    );

    const failingSuite: Suite<BenchmarkContext> = {
      name: "framework-suite",
      scenarios: [
        {
          name: "framework-blowup",
          version: "v2",
          async run() {
            throw new Error("framework exploded");
          },
        },
        {
          name: "never-runs",
          version: "v3",
          async run() {
            throw new Error("should never run");
          },
        },
      ],
    };

    expect(
      runBenchmarkSuite(
        failingSuite,
        {
          artifactBaseDir,
          budgetUsd: 1,
          modelId: "amazon.nova-lite-v1:0",
          timeoutMs: 10_000,
        },
        { retryDelaysMs: [1] }
      )
    ).rejects.toThrow("framework exploded");

    const indexJson = await readJson<{
      runs: Array<{
        failed: number;
        modelId: string;
        passed: number;
        runId: string;
        timestamp: string;
        totalScenarios: number;
      }>;
    }>(join(artifactBaseDir, "index.json"));
    expect(indexJson.runs).toHaveLength(2);

    const failedRun = indexJson.runs[indexJson.runs.length - 1];
    expect(failedRun).toBeDefined();

    if (!failedRun) {
      throw new Error("missing failed run entry");
    }
    expect(failedRun.failed).toBe(1);
    expect(failedRun.modelId).toBe("amazon.nova-lite-v1:0");
    expect(failedRun.passed).toBe(0);
    expect(typeof failedRun.runId).toBe("string");
    expect(typeof failedRun.timestamp).toBe("string");
    expect(failedRun.totalScenarios).toBe(1);
    const failedRunId = failedRun.runId;

    const summaryJson = await readJson<{
      failed: number;
      passed: number;
      providerInstability: number;
      totalScenarios: number;
    }>(join(artifactBaseDir, failedRunId, "suite-summary.json"));
    expect(summaryJson).toMatchObject({
      failed: 1,
      passed: 0,
      providerInstability: 0,
      totalScenarios: 1,
    });

    const failedResult = await readJson<{
      errorClass: string;
      errorMessage: string;
      status: string;
    }>(join(artifactBaseDir, failedRunId, "framework-blowup", "result.json"));
    expect(failedResult).toMatchObject({
      errorClass: "framework_regression",
      errorMessage: "framework exploded",
      status: "error",
    });
    expect(
      access(join(artifactBaseDir, failedRunId, "never-runs", "result.json"))
    ).rejects.toBeDefined();
    expect(await readlink(join(artifactBaseDir, "latest"))).toBe(firstRun.runId);
  });
});
