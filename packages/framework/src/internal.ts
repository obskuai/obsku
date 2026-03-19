// ============================================================================
// @obsku/framework/internal
// ============================================================================
// Base SQL store
export { AbstractSqlCheckpointStore } from "./checkpoint/abstract-sql-store";
// Errors
export {
  CheckpointNotFoundError,
  EntityNotFoundError,
  SessionNotFoundError,
} from "./checkpoint/errors";
// Migration templates
export type { DialectConfig } from "./checkpoint/migration-template";
export {
  generateMigrationSql,
  POSTGRES_MIGRATIONS,
  postgresDialect,
  SQLITE_MIGRATIONS,
  sqliteDialect,
} from "./checkpoint/migration-template";
// Stored message parsing
export { parseStoredMessage } from "./checkpoint/normalize-message";
// Row mappers
export {
  mapCheckpointRow,
  mapEntityRow,
  mapFactRow,
  mapMessageRow,
  mapSessionRow,
} from "./checkpoint/ops/base-mappers";
// Fork helpers
export { forkFromCheckpoint } from "./checkpoint/ops/fork";
// Builder helpers
export {
  buildEntity,
  buildFact,
  buildFilterConditions,
  buildSession,
  validateEntityExists,
} from "./checkpoint/ops/shared-helpers";
// SQL operations, checkpoints
export {
  sqlGetCheckpoint,
  sqlGetLatestCheckpoint,
  sqlListCheckpoints,
  sqlSaveCheckpoint,
} from "./checkpoint/ops/sql-checkpoint-ops";
// SQL operations, entities
export {
  sqlDeleteEntity,
  sqlGetEntityById,
  sqlListEntities,
  sqlSaveEntity,
  sqlUpdateEntity,
} from "./checkpoint/ops/sql-entity-ops";
// SQL operations, facts
export {
  sqlDeleteFact,
  sqlGetFact,
  sqlListFacts,
  sqlSaveFact,
} from "./checkpoint/ops/sql-fact-ops";
// SQL operations, messages
export {
  sqlAddMessage,
  sqlGetMessages,
} from "./checkpoint/ops/sql-message-ops";
// SQL operations, semantic search
export {
  sqlSearchEntitiesSemantic,
  sqlSearchFactsSemantic,
} from "./checkpoint/ops/sql-search-ops";
// SQL operations, sessions
export {
  sqlCreateSession,
  sqlDeleteSession,
  sqlGetSession,
  sqlListSessions,
  sqlUpdateSession,
} from "./checkpoint/ops/sql-session-ops";
// SQL executor interface
export type { SqlExecutor } from "./checkpoint/ops/sql-types";
// Validation schemas
export {
  CheckpointSchema,
  EntitySchema,
  FactSchema,
  SessionSchema,
  StoredMessageSchema,
  validate,
} from "./checkpoint/schemas";
// Serialization
export { JsonPlusSerializer } from "./checkpoint/serializer";
// Similarity and vector helpers
export {
  cosineSimilarity,
  deserializeEmbedding,
  serializeEmbedding,
  VectorDimensionError,
} from "./checkpoint/similarity";

// ============================================================================
// UTILITIES
// ============================================================================
export {
  assertNever,
  formatError,
  isAsyncIterable,
  normalizeStopReason,
} from "./generic-utils";
export { generateId } from "./id-utils";
export type { JsonParseResult } from "./json-utils";
export { extractJsonFromText, safeJsonParse } from "./json-utils";
export { telemetryLog } from "./telemetry/log";
export type { ToolResultEnvelope } from "./tool-result-utils";
export {
  isToolOutput,
  normalizeToolResultBoundary,
  normalizeToolResultPayload,
  toToolResultEnvelope,
  toToolResultOutput,
} from "./tool-result-utils";

// ============================================================================
// ERROR UTILITIES (for dependent packages)
// ============================================================================
export {
  classifyError,
  getErrorMessage,
  getErrorStack,
  isRetryEligible,
  toErrorRecord,
} from "./error-utils";
export type { ErrorClass } from "./error-utils";
