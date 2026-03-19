import { z } from "zod";

// =============================================================================
// Helper Types and Validation
// =============================================================================

/**
 * Validate data against a Zod schema.
 * Returns the parsed data on success, null on failure (never throws).
 */
export function validate<T>(schema: z.ZodType<T>, data: unknown): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

export const UnknownRecordSchema = z.object({}).catchall(z.unknown());

// =============================================================================
// Supporting Schemas (from types)
// =============================================================================

export const RelationshipSchema = z.object({
  targetId: z.string(),
  type: z.string(),
});

export const StoredToolResultSchema = z.object({
  content: z.string(),
  fullOutputRef: z.string().optional(),
  status: z.string().optional(),
  toolUseId: z.string(),
});

export const StoredMessageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);

export const ToolCallInputSchema = z.object({}).catchall(z.unknown());

export const CheckpointNodeResultSchema = z.object({
  completedAt: z.number().optional(),
  error: z.string().optional(),
  output: z.unknown().optional(),
  startedAt: z.number().optional(),
  status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
});

export const ToolCallSchema = z.object({
  function: z.object({
    arguments: z.string(),
    name: z.string(),
  }),
  id: z.string(),
  type: z.string(),
});

export const RuntimeToolCallSchema = z.object({
  input: ToolCallInputSchema,
  name: z.string(),
  toolUseId: z.string(),
});

// =============================================================================
// Record Schemas (for loose validation of raw data before coercion)
// Used by storage backends to validate deserialized records
// =============================================================================

/**
 * Schema for raw tool call record (loose validation).
 * Used when normalizing tool calls from storage formats.
 */
export const ToolCallRecordSchema = z.object({
  input: z.unknown(),
  name: z.string(),
  toolUseId: z.string(),
});

/**
 * Schema for stored tool call format (with function.arguments as string).
 * Used when parsing stored tool call format.
 */
export const StoredToolCallSchema = z.object({
  function: z.object({
    arguments: z.string(),
    name: z.string(),
  }),
  id: z.string(),
  type: z.string(),
});

/**
 * Schema for raw message record (loose validation).
 * Uses z.string() for role instead of z.enum() to allow coercion.
 */
export const StoredMessageRecordSchema = z.object({
  content: z.string().optional(),
  createdAt: z.number(),
  id: z.number(),
  role: z.string(),
  sessionId: z.string(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  toolCalls: z.array(z.unknown()).optional(),
  toolResults: z.array(z.unknown()).optional(),
});

// =============================================================================
// Main Domain Schemas
// =============================================================================

/**
 * Schema for Session entity.
 * Represents a conversation/session context.
 */
export const SessionSchema = z.object({
  createdAt: z.number(),
  directory: z.string(),
  id: z.string(),
  metadata: z.object({}).catchall(z.unknown()).optional(),
  title: z.string().optional(),
  updatedAt: z.number(),
  workspaceId: z.string().optional(),
});

/**
 * Schema for Checkpoint entity.
 * Represents a point-in-time state of graph execution.
 */
export const CheckpointSchema = z.object({
  createdAt: z.number(),
  cycleState: z
    .object({
      backEdge: z.string(),
      iteration: z.number(),
    })
    .optional(),
  id: z.string(),
  namespace: z.string(),
  nodeId: z.string().optional(),
  nodeResults: z.object({}).catchall(CheckpointNodeResultSchema),
  parentId: z.string().optional(),
  pendingNodes: z.array(z.string()),
  sessionId: z.string(),
  source: z.enum(["input", "loop", "interrupt", "fork"]),
  step: z.number(),
  version: z.number(),
});

/**
 * Schema for StoredMessage entity.
 * Represents a persisted message in conversation history.
 */
export const StoredMessageSchema = z.object({
  content: z.string().optional(),
  createdAt: z.number(),
  id: z.number(),
  role: StoredMessageRoleSchema,
  sessionId: z.string(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolResults: z.array(StoredToolResultSchema).optional(),
});

export const ParsedStoredMessageSchema = z.object({
  content: z.string().optional(),
  createdAt: z.number(),
  id: z.number(),
  role: StoredMessageRoleSchema,
  sessionId: z.string(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  toolCalls: z.array(RuntimeToolCallSchema).optional(),
  toolResults: z.array(StoredToolResultSchema).optional(),
});

/**
 * Schema for Entity (memory system).
 * Represents an extracted entity from conversation.
 */
export const EntitySchema = z.object({
  attributes: z.object({}).catchall(z.unknown()),
  createdAt: z.number(),
  embedding: z.array(z.number()).optional(),
  id: z.string(),
  name: z.string(),
  relationships: z.array(RelationshipSchema),
  sessionId: z.string(),
  type: z.string(),
  updatedAt: z.number(),
  workspaceId: z.string().optional(),
});

/**
 * Schema for Fact (memory system).
 * Represents a learned fact about the workspace/domain.
 */
export const FactSchema = z.object({
  confidence: z.number().min(0).max(1),
  content: z.string(),
  createdAt: z.number(),
  embedding: z.array(z.number()).optional(),
  id: z.string(),
  sourceSessionId: z.string().optional(),
  workspaceId: z.string().optional(),
});
