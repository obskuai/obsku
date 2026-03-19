import { describe } from "bun:test";
import { runCheckpointRuntimeIntegrationTests } from "./framework-shared-test-helpers";
import { RedisCheckpointStore } from "../src/redis-store";

const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("Redis runtime integration", () => {
  runCheckpointRuntimeIntegrationTests({
    cleanup: async (store) => await store.close(),
    createStore: async () => new RedisCheckpointStore({ url: REDIS_URL! }),
    description: "Redis",
    supportsMultipleCheckpoints: false,
  });
});
