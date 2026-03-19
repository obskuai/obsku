import type { Database, SQLQueryBindings, Statement } from "bun:sqlite";
import type { SqlExecutor } from "@obsku/framework/checkpoint/backend-shared";

export class SqliteSqlExecutor implements SqlExecutor {
  constructor(private db: Database) {}

  execute(sql: string, params: Array<unknown> = []): void {
    this.prepare(sql).run(...(params as Array<SQLQueryBindings>));
  }

  queryAll<T>(sql: string, params: Array<unknown> = []): Array<T> {
    return this.prepare(sql).all(...(params as Array<SQLQueryBindings>)) as Array<T>;
  }

  queryOne<T>(sql: string, params: Array<unknown> = []): T | null {
    const row = this.prepare(sql).get(...(params as Array<SQLQueryBindings>)) as T | undefined;
    return row ?? null;
  }

  private prepare(sql: string): Statement {
    return this.db.query(sql);
  }
}
