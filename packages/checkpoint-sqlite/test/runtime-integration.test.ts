import { runCheckpointRuntimeIntegrationTests } from "./framework-shared-test-helpers";
import { SqliteCheckpointStore } from "../src/sqlite-store";

runCheckpointRuntimeIntegrationTests({
  cleanup: async (store) => await store.close(),
  createStore: async () => new SqliteCheckpointStore(":memory:"),
  description: "SQLite",
  supportsMultipleCheckpoints: false,
});
