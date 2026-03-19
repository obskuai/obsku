import {
  AbstractSqlCheckpointStore,
  JsonPlusSerializer,
  POSTGRES_MIGRATIONS,
} from "@obsku/framework/checkpoint/backend-shared";
import type { PoolConfig, Pool as PoolType } from "pg";
import pg from "pg";
import { forkCheckpoint } from "./ops/fork";
import { PostgresSqlExecutor } from "./postgres-sql-executor";

const { Pool } = pg;

export class PostgresCheckpointStore extends AbstractSqlCheckpointStore {
  private pool: PoolType;

  constructor(connectionString: string, options?: PoolConfig) {
    const pool = new Pool({ connectionString, ...options });
    const executor = new PostgresSqlExecutor(pool);
    super(executor, {
      fork: (checkpointId: string, opts?: { title?: string }) =>
        forkCheckpoint(pool, new JsonPlusSerializer(), checkpointId, opts),
      serializer: new JsonPlusSerializer(),
    });
    this.pool = pool;
  }

  async setup(): Promise<void> {
    await this.pool.query(POSTGRES_MIGRATIONS);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
