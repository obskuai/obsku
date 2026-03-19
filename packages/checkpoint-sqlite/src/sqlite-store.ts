import { Database } from "bun:sqlite";
import {
  AbstractSqlCheckpointStore,
  JsonPlusSerializer,
  SQLITE_MIGRATIONS,
} from "@obsku/framework/checkpoint/backend-shared";
import { SqliteSqlExecutor } from "./sqlite-sql-executor";

export class SqliteCheckpointStore extends AbstractSqlCheckpointStore {
  private db: Database;

  constructor(path: string = ":memory:") {
    const db = new Database(path);
    super(new SqliteSqlExecutor(db), { serializer: new JsonPlusSerializer() });
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.run("PRAGMA foreign_keys = ON;");
    for (const statement of SQLITE_MIGRATIONS.split(";")) {
      const sql = statement.trim();
      if (sql) {
        this.db.run(sql);
      }
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
