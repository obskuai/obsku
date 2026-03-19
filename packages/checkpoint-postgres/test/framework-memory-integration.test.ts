import { describe } from "bun:test";
import {
  createIsolatedPostgresStore,
  runMemoryIntegrationTests,
} from "./framework-shared-test-helpers";

const POSTGRES_URL = process.env.POSTGRES_URL;

describe.skipIf(!POSTGRES_URL)("Postgres framework memory integration", () => {
  runMemoryIntegrationTests({
    cleanup: async (store) =>
      await (store as Awaited<ReturnType<typeof createIsolatedPostgresStore>>["store"]).close(),
    createStore: async () => (await createIsolatedPostgresStore(POSTGRES_URL!)).store,
    description: "Postgres Backend",
    hasSemanticSearch: true,
  });
});
