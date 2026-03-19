// ============================================================================
// Migration SQL Dialect Template
// ============================================================================
// Generates dialect-specific migration SQL for SQLite and PostgreSQL.
// This ensures consistency across checkpoint store implementations.
// ============================================================================

/** Dialect configuration for generating migration SQL */
export interface DialectConfig {
  /** Auto-increment primary key syntax */
  readonly autoIncrement: string;
  /** Blob/bytea type for embeddings */
  readonly blobType: string;
  /** Whether embedding columns are added inline (SQLite) or via ALTER TABLE (PostgreSQL) */
  readonly inlineEmbeddings: boolean;
  /** Whether to use inline REFERENCES syntax (PostgreSQL) or separate FOREIGN KEY clause (SQLite) */
  readonly inlineReferences: boolean;
  /** Whether to use inline UNIQUE constraints (PostgreSQL) or CREATE UNIQUE INDEX (SQLite) */
  readonly inlineUnique: boolean;
  /** Integer type: INTEGER (SQLite) or BIGINT (PostgreSQL) */
  readonly intType: string;
  /** Primary key type for text IDs */
  readonly primaryKeyType: string;
}

/** SQLite dialect configuration */
export const sqliteDialect: DialectConfig = {
  autoIncrement: "INTEGER PRIMARY KEY AUTOINCREMENT",
  blobType: "BLOB",
  inlineEmbeddings: true,
  inlineReferences: false,
  inlineUnique: false,
  intType: "INTEGER",
  primaryKeyType: "TEXT PRIMARY KEY",
};

/** PostgreSQL dialect configuration */
export const postgresDialect: DialectConfig = {
  autoIncrement: "SERIAL PRIMARY KEY",
  blobType: "BYTEA",
  inlineEmbeddings: false,
  inlineReferences: true,
  inlineUnique: true,
  intType: "BIGINT",
  primaryKeyType: "TEXT PRIMARY KEY",
};

/** Generate session table SQL */
function generateSessionsTable(config: DialectConfig): string {
  return `CREATE TABLE IF NOT EXISTS sessions (
    id ${config.primaryKeyType},
    workspace_id TEXT,
    title TEXT,
    directory TEXT NOT NULL,
    created_at ${config.intType} NOT NULL,
    updated_at ${config.intType} NOT NULL,
    metadata TEXT
);`;
}

/** Generate sessions indexes */
function generateSessionsIndexes(): string {
  return "CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id, updated_at DESC);";
}

/** Generate messages table SQL */
function generateMessagesTable(config: DialectConfig): string {
  const sessionIdCol = config.inlineReferences
    ? "session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE"
    : "session_id TEXT NOT NULL";

  return `CREATE TABLE IF NOT EXISTS messages (
    id ${config.autoIncrement},
    ${sessionIdCol},
    role TEXT NOT NULL,
    content TEXT,
    tool_calls TEXT,
    tool_results TEXT,
    tokens_in INTEGER,
    tokens_out INTEGER,
    created_at ${config.intType} NOT NULL${config.inlineReferences ? "" : ",\n    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE"}
);`;
}

/** Generate messages indexes */
function generateMessagesIndexes(): string {
  return "CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);";
}

/** Generate checkpoints table SQL */
function generateCheckpointsTable(config: DialectConfig): string {
  const sessionIdCol = config.inlineReferences
    ? "session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE"
    : "session_id TEXT NOT NULL";

  // PostgreSQL uses NOT NULL for source, SQLite doesn't
  const sourceNullability = config.inlineReferences ? " NOT NULL" : "";

  // PostgreSQL uses inline UNIQUE constraint, SQLite uses CREATE UNIQUE INDEX
  const uniqueConstraint = config.inlineUnique
    ? ",\n    UNIQUE(session_id, namespace, version)"
    : "";

  return `CREATE TABLE IF NOT EXISTS checkpoints (
    id ${config.primaryKeyType},
    ${sessionIdCol},
    namespace TEXT NOT NULL DEFAULT '',
    parent_id TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    step INTEGER NOT NULL,
    node_id TEXT,
    node_results TEXT NOT NULL,
    pending_nodes TEXT,
    cycle_state TEXT,
    source TEXT${sourceNullability},
    created_at ${config.intType} NOT NULL${uniqueConstraint}${config.inlineReferences ? "" : ",\n    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE"}
);`;
}

/** Generate checkpoints indexes */
function generateCheckpointsIndexes(config: DialectConfig): string {
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id, namespace, step);",
  ];
  // SQLite uses CREATE UNIQUE INDEX for checkpoints version constraint
  if (!config.inlineUnique) {
    indexes.push(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_checkpoints_version ON checkpoints(session_id, namespace, version);"
    );
  }
  return indexes.join("\n");
}

/** Generate entities table SQL */
function generateEntitiesTable(config: DialectConfig): string {
  const sessionIdCol = config.inlineReferences
    ? "session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE"
    : "session_id TEXT NOT NULL";

  // SQLite has embedding inline, PostgreSQL adds it via ALTER TABLE
  const embeddingCol = config.inlineEmbeddings ? `,\n    embedding ${config.blobType}` : "";

  return `CREATE TABLE IF NOT EXISTS entities (
    id ${config.primaryKeyType},
    ${sessionIdCol},
    workspace_id TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    attributes TEXT,
    relationships TEXT,
    created_at ${config.intType} NOT NULL,
    updated_at ${config.intType} NOT NULL${embeddingCol}${config.inlineReferences ? "" : ",\n    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE"}
);`;
}

/** Generate entities indexes */
function generateEntitiesIndexes(): string {
  return [
    "CREATE INDEX IF NOT EXISTS idx_entities_session ON entities(session_id);",
    "CREATE INDEX IF NOT EXISTS idx_entities_workspace ON entities(workspace_id);",
    "CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);",
  ].join("\n");
}

/** Generate facts table SQL */
function generateFactsTable(config: DialectConfig): string {
  const sourceSessionIdCol = config.inlineReferences
    ? "source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL"
    : "source_session_id TEXT";

  // SQLite has embedding inline, PostgreSQL adds it via ALTER TABLE
  const embeddingCol = config.inlineEmbeddings ? `,\n    embedding ${config.blobType}` : "";

  // SQLite needs separate FOREIGN KEY clause for source_session_id
  const foreignKeyClause = !config.inlineReferences
    ? `,\n    FOREIGN KEY (source_session_id) REFERENCES sessions(id) ON DELETE SET NULL`
    : "";

  return `CREATE TABLE IF NOT EXISTS facts (
    id ${config.primaryKeyType},
    workspace_id TEXT,
    content TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    ${sourceSessionIdCol},
    created_at ${config.intType} NOT NULL${embeddingCol}${foreignKeyClause}
);`;
}

/** Generate facts indexes and post-table statements */
function generateFactsPost(config: DialectConfig): string {
  const indexes = ["CREATE INDEX IF NOT EXISTS idx_facts_workspace ON facts(workspace_id);"];

  // SQLite has idx_facts_confidence, PostgreSQL doesn't
  if (config.inlineEmbeddings) {
    indexes.push("CREATE INDEX IF NOT EXISTS idx_facts_confidence ON facts(confidence);");
  }

  // PostgreSQL adds embedding columns via ALTER TABLE
  if (!config.inlineEmbeddings) {
    indexes.push(
      "ALTER TABLE entities ADD COLUMN IF NOT EXISTS embedding BYTEA;",
      "ALTER TABLE facts ADD COLUMN IF NOT EXISTS embedding BYTEA;"
    );
  }

  return indexes.join("\n");
}

/** Generate complete migration SQL for a dialect */
export function generateMigrationSql(config: DialectConfig): string {
  const parts: Array<string> = [
    generateSessionsTable(config),
    generateSessionsIndexes(),
    "",
    generateMessagesTable(config),
    generateMessagesIndexes(),
    "",
    generateCheckpointsTable(config),
    generateCheckpointsIndexes(config),
    "",
    generateEntitiesTable(config),
    generateEntitiesIndexes(),
    "",
    generateFactsTable(config),
    generateFactsPost(config),
  ];

  return parts.join("\n");
}

// ============================================================================
// Pre-generated migrations for convenience
// ============================================================================

/** SQLite migration SQL - matches packages/checkpoint-sqlite/src/migrations.ts */
export const SQLITE_MIGRATIONS = generateMigrationSql(sqliteDialect);

/** PostgreSQL migration SQL - matches packages/checkpoint-postgres/src/migrations.ts */
export const POSTGRES_MIGRATIONS = generateMigrationSql(postgresDialect);
