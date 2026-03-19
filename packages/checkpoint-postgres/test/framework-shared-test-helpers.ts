import { PostgresCheckpointStore } from "../src/postgres-store";

export { runMemoryIntegrationTests } from "../../framework/test/checkpoint/shared/memory-integration";
export {
  runMemoryBackendCapabilityMatrixTests,
  runMemoryTests,
} from "../../framework/test/checkpoint/shared/memory-tests";
export { runCheckpointRuntimeIntegrationTests } from "../../framework/test/checkpoint/shared/runtime-integration";
export { runStoreTests } from "../../framework/test/checkpoint/shared/store-tests";

export async function createIsolatedPostgresStore(url: string): Promise<{
  cleanup: () => Promise<void>;
  store: PostgresCheckpointStore;
}> {
  const schema = `test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const adminStore = new PostgresCheckpointStore(url);
  const pool = (adminStore as unknown as { pool: { query: (sql: string) => Promise<unknown> } })
    .pool;

  await pool.query(`CREATE SCHEMA "${schema}"`);

  const store = new PostgresCheckpointStore(url, {
    options: `-c search_path=${schema}`,
  });
  await store.setup();

  return {
    cleanup: async () => {
      await store.close();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminStore.close();
    },
    store,
  };
}
