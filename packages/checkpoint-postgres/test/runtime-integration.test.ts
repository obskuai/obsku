import { describe } from "bun:test";
import {
  createIsolatedPostgresStore,
  runCheckpointRuntimeIntegrationTests,
} from "./framework-shared-test-helpers";

const POSTGRES_URL = process.env.POSTGRES_URL;

describe.skipIf(!POSTGRES_URL)("Postgres runtime integration", () => {
  runCheckpointRuntimeIntegrationTests({
    cleanup: async (store) => await store.close(),
    createStore: async () => (await createIsolatedPostgresStore(POSTGRES_URL!)).store,
    description: "Postgres",
    supportsMultipleCheckpoints: false,
  });
});
