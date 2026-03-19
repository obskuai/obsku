import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { SqliteCheckpointStore } from "@obsku/checkpoint-sqlite";
import type { CanonicalAgentEvent, CheckpointStore, LLMProvider } from "@obsku/framework";
import { bedrock } from "@obsku/provider-bedrock";
import { appendEventJsonl } from "../artifacts/writers";
import type { RunSpec } from "../types";

const DEFAULT_CONTEXT_WINDOW_SIZE = 300_000;

export class BenchmarkProviderInstabilityError extends Error {
  readonly isProviderInstability = true;

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "BenchmarkProviderInstabilityError";
  }
}

export class BenchmarkProviderTimeoutError extends Error {
  readonly isProviderTimeout = true;

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "BenchmarkProviderTimeoutError";
  }
}

export function providerInstability(
  message: string,
  cause?: unknown
): BenchmarkProviderInstabilityError {
  return new BenchmarkProviderInstabilityError(message, cause);
}

export interface BenchmarkIsolation {
  checkpointDbPath: string;
  checkpointStore: CheckpointStore;
  frameworkSessionId: string;
  scenarioDir: string;
  workspaceDir: string;
}

export interface EventSubscribable {
  subscribe(options?: {
    eventBusCapacity?: number;
    sessionId?: string;
  }): Promise<AsyncIterable<unknown>>;
}

export interface BenchmarkContext {
  checkpointDbPath: string;
  checkpointStore: CheckpointStore;
  collectAgentEvents<TResult>(
    subject: EventSubscribable,
    execute: (sessionId: string) => Promise<TResult>
  ): Promise<{ events: CanonicalAgentEvent[]; result: TResult }>;
  createBedrockProvider(options?: { maxOutputTokens?: number }): Promise<LLMProvider>;
  env: {
    artifactBaseDir: string;
    contextWindowSize: number;
    maxCostUsd: number;
    modelId: string;
    region: string;
    sessionPrefix: string;
  };
  frameworkSessionId: string;
  getEvents(): ReadonlyArray<CanonicalAgentEvent>;
  modelId: string;
  recordEvent(event: CanonicalAgentEvent): Promise<void>;
  runId: string;
  scenarioDir: string;
  spec: RunSpec;
  workspaceDir: string;
}

export interface CreateBenchmarkContextOptions {
  artifactBaseDir: string;
  runId: string;
  scenarioName: string;
  spec: RunSpec;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEventDrain(getCount: () => number): Promise<void> {
  let stableReads = 0;

  for (let attempt = 0; attempt < 20; attempt++) {
    const before = getCount();
    await delay(10);
    const after = getCount();

    if (after === before) {
      stableReads += 1;
      if (stableReads >= 2) {
        return;
      }
      continue;
    }

    stableReads = 0;
  }
}

async function closeIteratorSafely(
  iterator: AsyncIterator<unknown>,
  task: Promise<unknown>
): Promise<void> {
  await Promise.race([
    Promise.allSettled([iterator.return?.(), task.catch(() => undefined)]),
    delay(100),
  ]);
}

export async function createScenarioIsolation(
  options: CreateBenchmarkContextOptions
): Promise<BenchmarkIsolation> {
  const scenarioDir = join(options.artifactBaseDir, options.runId, options.scenarioName);
  const workspaceDir = join(scenarioDir, "workspace");
  const checkpointDbPath = join(scenarioDir, "checkpoint.db");

  await mkdir(workspaceDir, { recursive: true });

  const checkpointStore = new SqliteCheckpointStore(checkpointDbPath);
  const session = await checkpointStore.createSession(workspaceDir, {
    metadata: { benchmarkRunId: options.runId, scenarioName: options.scenarioName },
    title: `Benchmark: ${options.scenarioName}`,
    workspaceId: `${options.runId}-${randomUUID()}`,
  });

  return {
    checkpointDbPath,
    checkpointStore,
    frameworkSessionId: session.id,
    scenarioDir,
    workspaceDir,
  };
}

export async function cleanupScenarioIsolation(isolation: BenchmarkIsolation): Promise<void> {
  try {
    await isolation.checkpointStore.close();
  } catch (e) { console.warn("[benchmark] checkpoint store close failed:", e); }

  await Promise.allSettled([
    rm(isolation.checkpointDbPath, { force: true }),
    rm(isolation.workspaceDir, { force: true, recursive: true }),
  ]);
}

export async function createBenchmarkContext(
  options: CreateBenchmarkContextOptions
): Promise<BenchmarkContext & BenchmarkIsolation> {
  const isolation = await createScenarioIsolation(options);
  const events: CanonicalAgentEvent[] = [];

  const recordEvent = async (event: CanonicalAgentEvent): Promise<void> => {
    events.push(event);
    await appendEventJsonl(isolation.scenarioDir, event);
  };

  return {
    checkpointDbPath: isolation.checkpointDbPath,
    checkpointStore: isolation.checkpointStore,
    async collectAgentEvents<TResult>(
      subject: EventSubscribable,
      execute: (sessionId: string) => Promise<TResult>
    ): Promise<{ events: CanonicalAgentEvent[]; result: TResult }> {
      const stream = await subject.subscribe({ sessionId: isolation.frameworkSessionId });
      const iterator = stream[Symbol.asyncIterator]();
      const collected: CanonicalAgentEvent[] = [];
      const task = (async () => {
        while (true) {
          const next = await iterator.next();
          if (next.done) return;
          const event = next.value as CanonicalAgentEvent;
          collected.push(event);
          await recordEvent(event);
        }
      })();

      try {
        const result = await execute(isolation.frameworkSessionId);
        await waitForEventDrain(() => collected.length);
        await closeIteratorSafely(iterator, task);
        return { events: collected, result };
      } catch (error) {
        await delay(0);
        await closeIteratorSafely(iterator, task);
        throw error;
      }
    },
    async createBedrockProvider(providerOptions?: {
      maxOutputTokens?: number;
    }): Promise<LLMProvider> {
      return bedrock({
        contextWindowSize: providerOptions?.maxOutputTokens
          ? (options.spec.contextWindowSize ?? DEFAULT_CONTEXT_WINDOW_SIZE)
          : undefined,
        maxOutputTokens: providerOptions?.maxOutputTokens ?? 1024,
        model: options.spec.modelId,
        region: options.spec.region ?? "us-east-1",
      });
    },
    env: {
      artifactBaseDir: options.artifactBaseDir,
      contextWindowSize: options.spec.contextWindowSize ?? DEFAULT_CONTEXT_WINDOW_SIZE,
      maxCostUsd: options.spec.budgetUsd,
      modelId: options.spec.modelId,
      region: options.spec.region ?? "us-east-1",
      sessionPrefix: options.spec.sessionPrefix ?? "bench",
    },
    frameworkSessionId: isolation.frameworkSessionId,
    getEvents(): ReadonlyArray<CanonicalAgentEvent> {
      return events;
    },
    modelId: options.spec.modelId,
    recordEvent,
    runId: options.runId,
    scenarioDir: isolation.scenarioDir,
    spec: options.spec,
    workspaceDir: isolation.workspaceDir,
  };
}
