export interface SqlDialect {
  autoId(): string;
  param(index: number): string;
  returning(columns: Array<string>): string;
}

export const sqliteDialect: SqlDialect = {
  autoId: () => "",
  param: () => "?",
  returning: () => "",
};

export const postgresDialect: SqlDialect = {
  autoId: () => "DEFAULT",
  param: (i) => `$${i}`,
  returning: (cols) => `RETURNING ${cols.join(", ")}`,
};
