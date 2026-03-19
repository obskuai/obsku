/**
 * Generic SQL executor interface for shared checkpoint operations.
 * SQLite and PostgreSQL stores implement this interface.
 */
export interface SqlExecutor {
  /** Execute a statement (INSERT, UPDATE, DELETE) */
  execute(sql: string, params: Array<unknown>): Promise<void> | void;
  /** Execute a query returning multiple rows */
  queryAll<T>(sql: string, params: Array<unknown>): Promise<Array<T>> | Array<T>;
  /** Execute a query returning a single row or null */
  queryOne<T>(sql: string, params: Array<unknown>): Promise<T | null> | T | null;
}
