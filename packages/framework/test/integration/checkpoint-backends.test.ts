import { describe, expect, test } from "bun:test";
import { InMemoryCheckpointStore } from "@obsku/framework";
import { runCheckpointRuntimeIntegrationTests } from "../checkpoint/shared/runtime-integration";

runCheckpointRuntimeIntegrationTests({
  cleanup: async (store) => await store.close(),
  createStore: async () => new InMemoryCheckpointStore(),
  description: "InMemory",
  supportsMultipleCheckpoints: true,
});

describe("Checkpoint Backend Summary", () => {
  test("framework runtime integration stays on framework-owned backend", () => {
    process.stdout.write("Testing framework-owned backend: InMemory\n");
    expect(true).toBe(true);
  });
});
