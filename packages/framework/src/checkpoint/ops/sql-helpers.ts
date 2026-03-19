/**
 * Internal SQL helper module for shared WHERE-clause building, LIMIT handling, and SELECT alias fragments.
 * Pure functions and constants only — no classes, no state, no Effect dependencies.
 * Extracted to reduce repetition across sql-*-ops.ts files.
 *
 * @internal
 */

/**
 * Shared SELECT column aliases for entities table.
 * Used by: sql-search-ops.ts, sql-entity-ops.ts
 */
export const ENTITY_SELECT_COLS = `id, session_id as sessionId, workspace_id as workspaceId, name, type, attributes, relationships, created_at as createdAt, updated_at as updatedAt, embedding`;

/**
 * Shared SELECT column aliases for facts table.
 * Used by: sql-search-ops.ts, sql-fact-ops.ts
 */
export const FACT_SELECT_COLS = `id, workspace_id as workspaceId, content, confidence, source_session_id as sourceSessionId, created_at as createdAt, embedding`;

/**
 * Shared SELECT column aliases for checkpoints table.
 * Used by: sql-checkpoint-ops.ts
 */
export const CHECKPOINT_SELECT_COLS = `id, session_id as sessionId, namespace, parent_id as parentId, version, step, node_id as nodeId, node_results as nodeResults, pending_nodes as pendingNodes, cycle_state as cycleState, source, created_at as createdAt`;

/**
 * Build a WHERE clause from conditions array.
 * Returns the clause with "WHERE" prefix, or empty string if no conditions.
 *
 * @param conditions - Array of WHERE condition strings
 * @returns WHERE clause with prefix, or empty string
 */
export function buildWhereClause(conditions: Array<string>): string {
  if (conditions.length === 0) {
    return "";
  }
  return ` WHERE ${conditions.join(" AND ")}`;
}

/**
 * Build a WHERE clause that always includes at least one condition.
 * Typically used to enforce a WHERE clause with at least one initial condition (e.g., "embedding IS NOT NULL").
 *
 * @param conditions - Array of WHERE condition strings (expected to have at least one)
 * @returns WHERE clause with "WHERE" prefix
 */
export function buildWhereClauseRequired(conditions: Array<string>): string {
  return ` WHERE ${conditions.join(" AND ")}`;
}

/**
 * Build a LIMIT clause for parameterized queries.
 * Supports both parameterized (pushes limit to params) and non-parameterized modes.
 *
 * @param limit - Limit value (undefined/0 means no limit)
 * @param params - Array to push limit value into (for parameterized queries). If undefined, returns non-parameterized clause.
 * @returns LIMIT clause with space prefix, or empty string if no limit
 */
export function buildLimitClause(
  limit: number | undefined,
  params?: Array<string | number>
): string {
  if (!limit || limit <= 0) {
    return "";
  }
  if (params !== undefined) {
    params.push(limit);
    return " LIMIT ?";
  }
  return ` LIMIT ${limit}`;
}

/**
 * Build an OFFSET clause for parameterized queries.
 *
 * @param offset - Offset value (undefined/0 means no offset)
 * @param params - Array to push offset value into (for parameterized queries). If undefined, returns non-parameterized clause.
 * @returns OFFSET clause with space prefix, or empty string if no offset
 */
export function buildOffsetClause(
  offset: number | undefined,
  params?: Array<string | number>
): string {
  if (!offset || offset <= 0) {
    return "";
  }
  if (params !== undefined) {
    params.push(offset);
    return " OFFSET ?";
  }
  return ` OFFSET ${offset}`;
}
