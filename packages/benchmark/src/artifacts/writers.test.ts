import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SuiteSummary } from "./schemas";
import type { RunIndex } from "./writers";
import { writeRunIndex } from "./writers";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function makeSummary(overrides: Partial<SuiteSummary> = {}): SuiteSummary {
  return {
    failed: 0,
    finishedAt: "2026-01-01T01:00:00.000Z",
    passed: 1,
    providerInstability: 0,
    runId: "run-001",
    startedAt: "2026-01-01T00:00:00.000Z",
    totalCostUsd: 0.0001,
    totalScenarios: 1,
    ...overrides,
  };
}

// ---------- writeRunIndex ----------

describe("writeRunIndex", () => {
  const cleanupDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(cleanupDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  });

  test("creates index.json with one entry when no file exists", async () => {
    const dir = await createTempDir("benchmark-index-");
    cleanupDirs.push(dir);

    const summary = makeSummary({ runId: "run-001", passed: 3, failed: 1, totalScenarios: 4 });
    await writeRunIndex(dir, summary, "amazon.nova-lite-v1:0");

    const raw = await readFile(join(dir, "index.json"), "utf8");
    const index = JSON.parse(raw) as RunIndex;

    expect(index.runs).toHaveLength(1);
    const entry = index.runs[0]!;
    expect(entry.runId).toBe("run-001");
    expect(entry.modelId).toBe("amazon.nova-lite-v1:0");
    expect(entry.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(entry.totalScenarios).toBe(4);
    expect(entry.passed).toBe(3);
    expect(entry.failed).toBe(1);
  });

  test("appends to existing index without overwriting prior entries", async () => {
    const dir = await createTempDir("benchmark-index-append-");
    cleanupDirs.push(dir);

    // First run
    const summary1 = makeSummary({ runId: "run-001", startedAt: "2026-01-01T00:00:00.000Z" });
    await writeRunIndex(dir, summary1, "model-a");

    // Second run
    const summary2 = makeSummary({ runId: "run-002", startedAt: "2026-01-02T00:00:00.000Z" });
    await writeRunIndex(dir, summary2, "model-b");

    const raw = await readFile(join(dir, "index.json"), "utf8");
    const index = JSON.parse(raw) as RunIndex;

    expect(index.runs).toHaveLength(2);
    expect(index.runs[0]?.runId).toBe("run-001");
    expect(index.runs[1]?.runId).toBe("run-002");
    expect(index.runs[0]?.modelId).toBe("model-a");
    expect(index.runs[1]?.modelId).toBe("model-b");
  });

  test("includes avgCompositeScore when summary has it", async () => {
    const dir = await createTempDir("benchmark-index-score-");
    cleanupDirs.push(dir);

    const summary = makeSummary({ avgCompositeScore: 0.87 });
    await writeRunIndex(dir, summary, "model-a");

    const raw = await readFile(join(dir, "index.json"), "utf8");
    const index = JSON.parse(raw) as RunIndex;

    expect(index.runs[0]?.avgCompositeScore).toBeCloseTo(0.87);
  });

  test("omits avgCompositeScore when summary does not have it", async () => {
    const dir = await createTempDir("benchmark-index-noscore-");
    cleanupDirs.push(dir);

    const summary = makeSummary();
    delete (summary as Partial<SuiteSummary>).avgCompositeScore;
    await writeRunIndex(dir, summary, "model-a");

    const raw = await readFile(join(dir, "index.json"), "utf8");
    const index = JSON.parse(raw) as RunIndex;

    expect(Object.prototype.hasOwnProperty.call(index.runs[0], "avgCompositeScore")).toBe(false);
  });

  test("three sequential appends accumulate all entries", async () => {
    const dir = await createTempDir("benchmark-index-triple-");
    cleanupDirs.push(dir);

    for (let i = 1; i <= 3; i++) {
      await writeRunIndex(dir, makeSummary({ runId: `run-00${i}` }), `model-${i}`);
    }

    const raw = await readFile(join(dir, "index.json"), "utf8");
    const index = JSON.parse(raw) as RunIndex;

    expect(index.runs).toHaveLength(3);
    expect(index.runs.map((r) => r.runId)).toEqual(["run-001", "run-002", "run-003"]);
  });

  test("recovers gracefully when existing file has invalid JSON", async () => {
    const dir = await createTempDir("benchmark-index-corrupt-");
    cleanupDirs.push(dir);

    // Write garbage to the index file
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "index.json"), "NOT_VALID_JSON", "utf8");

    // Should not throw; treats file as missing and starts fresh
    const summary = makeSummary({ runId: "run-after-corrupt" });
    await writeRunIndex(dir, summary, "model-a");

    const raw = await readFile(join(dir, "index.json"), "utf8");
    const index = JSON.parse(raw) as RunIndex;

    expect(index.runs).toHaveLength(1);
    expect(index.runs[0]?.runId).toBe("run-after-corrupt");
  });
});
