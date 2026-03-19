// ============================================================================
// @obsku/framework/checkpoint/backend-shared
// ============================================================================
// Stable public seam for checkpoint backend packages.
// Backend packages (checkpoint-sqlite, checkpoint-postgres, checkpoint-redis, etc.)
// MUST import from this path instead of @obsku/framework/internal.
// ============================================================================

// Base SQL store
export { AbstractSqlCheckpointStore } from "./abstract-sql-store";

// Errors
export {
  CheckpointNotFoundError,
  EntityNotFoundError,
  SessionNotFoundError,
} from "./errors";

// Migration templates
export type { DialectConfig } from "./migration-template";
export {
  generateMigrationSql,
  POSTGRES_MIGRATIONS,
  postgresDialect,
  SQLITE_MIGRATIONS,
  sqliteDialect,
} from "./migration-template";

// Stored message parsing
export { parseStoredMessage } from "./normalize-message";

// Fork helpers
export { forkFromCheckpoint } from "./ops/fork";

// Builder helpers
export {
  buildEntity,
  buildFact,
  buildFilterConditions,
  buildSession,
  validateEntityExists,
} from "./ops/shared-helpers";

// Row mappers
export {
  mapCheckpointRow,
  mapEntityRow,
  mapFactRow,
  mapMessageRow,
  mapSessionRow,
} from "./ops/base-mappers";

// SQL executor interface
export type { SqlExecutor } from "./ops/sql-types";

// Validation schemas
export {
  CheckpointSchema,
  EntitySchema,
  FactSchema,
  SessionSchema,
  validate,
} from "./schemas";

// Serialization
export { JsonPlusSerializer } from "./serializer";
