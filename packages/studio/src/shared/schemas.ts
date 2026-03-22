import { z } from "zod";

// =============================================================================
// Base Schemas
// =============================================================================

export const ToolDisplaySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});

export const MemoryDisplaySchema = z.object({
  type: z.enum(["summarization", "buffer", "custom", "none"]),
  maxMessages: z.number().optional(),
});

export const EdgeDisplaySchema = z.object({
  from: z.string(),
  to: z.string(),
  back: z.boolean().optional(),
});

export const NodeDisplaySchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  type: z.enum(["agent", "graph", "fn"]),
  status: z.enum(["Pending", "Running", "Complete", "Failed", "Skipped"]).optional(),
});

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string().optional(),
  timestamp: z.number(),
  toolCalls: z
    .array(
      z.object({
        toolName: z.string(),
        args: z.record(z.string(), z.unknown()),
      })
    )
    .optional(),
  toolResults: z
    .array(
      z.object({
        toolName: z.string(),
        result: z.unknown(),
        isError: z.boolean().optional(),
      })
    )
    .optional(),
});

// =============================================================================
// Agent Schemas
// =============================================================================

export const AgentDisplaySchema = z.object({
  name: z.string(),
  promptPreview: z.string(),
  tools: z.array(ToolDisplaySchema),
  memory: MemoryDisplaySchema.optional(),
  guardrailsCount: z.object({
    input: z.number(),
    output: z.number(),
  }),
  handoffsCount: z.number(),
  maxIterations: z.number(),
  streaming: z.boolean(),
  toolTimeout: z.number(),
  toolConcurrency: z.number(),
});

export const AgentListItemSchema = z.object({
  name: z.string(),
  description: z.string(),
  toolCount: z.number(),
});

export const AgentListResponse = z.object({
  success: z.literal(true),
  agents: z.array(AgentListItemSchema),
});

export const AgentDetailResponse = z.object({
  success: z.literal(true),
  agent: AgentDisplaySchema,
});

// =============================================================================
// Graph Schemas
// =============================================================================

export const GraphDisplaySchema = z.object({
  nodes: z.record(z.string(), NodeDisplaySchema),
  edges: z.array(EdgeDisplaySchema),
  backEdges: z.array(EdgeDisplaySchema),
  executionOrder: z.array(z.string()),
  entry: z.string(),
});

export const GraphListResponse = z.object({
  success: z.literal(true),
  graphs: z.array(
    z.object({
      id: z.string(),
      nodeCount: z.number(),
      edgeCount: z.number(),
    })
  ),
});

export const GraphDetailResponse = z.object({
  success: z.literal(true),
  graph: GraphDisplaySchema,
});

// =============================================================================
// Session Schemas
// =============================================================================

export const SessionDisplaySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  status: z.enum(["active", "completed", "failed", "interrupted"]),
  messageCount: z.number(),
  updatedAt: z.number().optional(),
});

export const SessionListResponse = z.object({
  success: z.literal(true),
  sessions: z.array(SessionDisplaySchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

export const SessionDetailResponse = z.object({
  success: z.literal(true),
  session: SessionDisplaySchema,
  events: z.array(z.lazy(() => EventDisplaySchema)),
});

// =============================================================================
// Chat Schemas
// =============================================================================

export const ChatRequest = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  agentName: z.string().min(1),
  stream: z.boolean().optional(),
});

export const ChatResponse = z.object({
  success: z.literal(true),
  message: z.object({
    id: z.string(),
    role: z.literal("assistant"),
    content: z.string(),
    timestamp: z.number(),
  }),
  sessionId: z.string(),
});

export const ChatStreamResponse = z.object({
  success: z.literal(true),
  sessionId: z.string(),
  stream: z.literal(true),
});

// =============================================================================
// Event Schemas
// =============================================================================

export const EventDisplaySchema = z.object({
  type: z.string(),
  category: z.enum([
    "session",
    "agent",
    "tool",
    "graph",
    "background",
    "checkpoint",
    "guardrail",
    "handoff",
    "supervisor",
    "context",
    "error",
    "stream",
  ]),
  timestamp: z.number(),
  agent: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
  severity: z.enum(["info", "success", "warning", "error"]),
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
});

export const EventListResponse = z.object({
  success: z.literal(true),
  events: z.array(EventDisplaySchema),
  hasMore: z.boolean(),
});

// =============================================================================
// Error Schema
// =============================================================================

export const ErrorResponse = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

// =============================================================================
// Union Response Type
// =============================================================================

export const ApiResponse = z.union([
  AgentListResponse,
  AgentDetailResponse,
  GraphListResponse,
  GraphDetailResponse,
  SessionListResponse,
  SessionDetailResponse,
  ChatResponse,
  ChatStreamResponse,
  EventListResponse,
  ErrorResponse,
]);

// =============================================================================
// Type Exports
// =============================================================================

export type AgentListResponseType = z.infer<typeof AgentListResponse>;
export type AgentDetailResponseType = z.infer<typeof AgentDetailResponse>;
export type GraphListResponseType = z.infer<typeof GraphListResponse>;
export type GraphDetailResponseType = z.infer<typeof GraphDetailResponse>;
export type SessionListResponseType = z.infer<typeof SessionListResponse>;
export type SessionDetailResponseType = z.infer<typeof SessionDetailResponse>;
export type ChatRequestType = z.infer<typeof ChatRequest>;
export type ChatResponseType = z.infer<typeof ChatResponse>;
export type ChatStreamResponseType = z.infer<typeof ChatStreamResponse>;
export type ErrorResponseType = z.infer<typeof ErrorResponse>;
export type ApiResponseType = z.infer<typeof ApiResponse>;
