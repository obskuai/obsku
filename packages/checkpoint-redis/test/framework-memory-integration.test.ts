import { describe } from "bun:test";
import { runMemoryIntegrationTests } from "./framework-shared-test-helpers";
import { RedisCheckpointStore } from "../src/redis-store";

const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("Redis framework memory integration", () => {
  runMemoryIntegrationTests({
    cleanup: async (store) => await (store as RedisCheckpointStore).close(),
    createStore: async () => new RedisCheckpointStore({ url: REDIS_URL! }),
    description: "Redis Backend",
    hasSemanticSearch: false,
  });
});
