import { runMemoryIntegrationTests } from "./framework-shared-test-helpers";
import { SqliteCheckpointStore } from "../src/sqlite-store";

runMemoryIntegrationTests({
  cleanup: async (store) => await (store as SqliteCheckpointStore).close(),
  createStore: async () => new SqliteCheckpointStore(":memory:"),
  description: "SQLite Backend",
  hasSemanticSearch: true,
});
