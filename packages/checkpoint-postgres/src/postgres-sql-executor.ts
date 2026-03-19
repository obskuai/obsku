import type { SqlExecutor } from "@obsku/framework/checkpoint/backend-shared";
import type { Pool as PoolType } from "pg";

const POSTGRES_LOWERCASE_ALIAS_MAP: Record<string, string> = {
  createdat: "createdAt",
  cyclestate: "cycleState",
  nodeid: "nodeId",
  noderesults: "nodeResults",
  parentid: "parentId",
  pendingnodes: "pendingNodes",
  sessionid: "sessionId",
  sourceSessionId: "sourceSessionId",
  sourcesessionid: "sourceSessionId",
  tokensin: "tokensIn",
  tokensout: "tokensOut",
  updatedat: "updatedAt",
  workspaceid: "workspaceId",
};

const normalizeRow = <T>(row: T): T => {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return row;
  }

  const normalized = { ...(row as Record<string, unknown>) };
  for (const [key, value] of Object.entries(normalized)) {
    const mappedKey = POSTGRES_LOWERCASE_ALIAS_MAP[key];
    if (mappedKey && !(mappedKey in normalized)) {
      normalized[mappedKey] = value;
    }
  }

  return normalized as T;
};

export const translateSqlPlaceholders = (sql: string): string => {
  let translated = "";
  let paramIndex = 0;
  let inSingleQuote = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];

    if (char === "'") {
      translated += char;
      if (inSingleQuote) {
        const nextChar = sql[i + 1];
        if (nextChar === "'") {
          translated += nextChar;
          i += 1;
          continue;
        }
        inSingleQuote = false;
      } else {
        inSingleQuote = true;
      }
      continue;
    }

    if (char === "?" && !inSingleQuote) {
      paramIndex += 1;
      translated += `$${paramIndex}`;
      continue;
    }

    translated += char;
  }

  return translated;
};

export class PostgresSqlExecutor implements SqlExecutor {
  constructor(private pool: PoolType) {}

  async execute(sql: string, params: Array<unknown> = []): Promise<void> {
    await this.run(sql, params);
  }

  async queryAll<T>(sql: string, params: Array<unknown> = []): Promise<Array<T>> {
    return this.all<T>(sql, params);
  }

  async queryOne<T>(sql: string, params: Array<unknown> = []): Promise<T | null> {
    return this.get<T>(sql, params);
  }

  async run(sql: string, params: Array<unknown> = []): Promise<void> {
    const translated = translateSqlPlaceholders(sql);
    await this.pool.query(translated, params);
  }

  async all<T>(sql: string, params: Array<unknown> = []): Promise<Array<T>> {
    const translated = translateSqlPlaceholders(sql);
    const result = await this.pool.query(translated, params);
    return result.rows.map((row) => normalizeRow(row)) as Array<T>;
  }

  async get<T>(sql: string, params: Array<unknown> = []): Promise<T | null> {
    const translated = translateSqlPlaceholders(sql);
    const result = await this.pool.query(translated, params);
    return result.rows[0] ? (normalizeRow(result.rows[0]) as T) : null;
  }
}
