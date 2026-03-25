// =============================================================================
// @obsku/studio — Display types for UI consumption
// Safe subsets of framework types without internal implementation details
// =============================================================================

// =============================================================================
// Agent Display Types
// =============================================================================

/**
 * Memory configuration display info
 * Subset of MemoryConfig without internal providers
 */
export interface MemoryDisplayInfo {
  type: "summarization" | "buffer" | "custom" | "none";
  maxMessages?: number;
}

/**
 * Tool reference for display
 */
export interface ToolDisplayInfo {
  name: string;
  description?: string;
}

/**
 * Subset of AgentDef for UI display
 * Excludes internal fields like agentFactory, beforeLLMCall, etc.
 */
export interface AgentDisplayInfo {
  name: string;
  runtimeModel?: string;
  promptPreview: string;
  tools: ToolDisplayInfo[];
  memory?: MemoryDisplayInfo;
  guardrailsCount: { input: number; output: number };
  handoffsCount: number;
  maxIterations: number;
  streaming: boolean;
  toolTimeout: number;
  toolConcurrency: number;
}

// =============================================================================
// Graph Display Types
// =============================================================================

/**
 * Node status for display
 */
export type NodeDisplayStatus = "Pending" | "Running" | "Complete" | "Failed" | "Skipped";

/**
 * Node type classification
 */
export type NodeType = "agent" | "graph" | "fn";

/**
 * Edge display info
 */
export interface EdgeDisplayInfo {
  from: string;
  to: string;
  back?: boolean;
}

/**
 * Single graph node for display
 */
export interface NodeDisplayInfo {
  id: string;
  description?: string;
  type: NodeType;
  status?: NodeDisplayStatus;
}

/**
 * Graph structure for display
 * Excludes internal fields like executor functions, conditions
 */
export interface GraphDisplayInfo {
  /** Map of node IDs to display info */
  nodes: Record<string, NodeDisplayInfo>;
  /** All edges in the graph */
  edges: EdgeDisplayInfo[];
  /** Back edges (cycles) */
  backEdges: EdgeDisplayInfo[];
  /** Topologically sorted execution order */
  executionOrder: string[];
  /** Entry node ID */
  entry: string;
}

// =============================================================================
// Session Display Types
// =============================================================================

/**
 * Session status
 */
export type SessionDisplayStatus = "active" | "completed" | "failed" | "interrupted";

/**
 * Session summary for list views
 */
export interface SessionDisplayInfo {
  /** Session ID */
  id: string;
  /** Session title or first message preview */
  title: string;
  /** Creation timestamp */
  createdAt: number;
  runtimeModel?: string;
  /** Current status */
  status: SessionDisplayStatus;
  /** Number of messages in session */
  messageCount: number;
  /** Last updated timestamp */
  updatedAt?: number;
}

// =============================================================================
// Event Display Types
// =============================================================================

/**
 * Event display category for UI grouping
 */
export type EventDisplayCategory =
  | "session" // Session lifecycle events
  | "agent" // Agent lifecycle events
  | "tool" // Tool execution events
  | "graph" // Graph execution events
  | "background" // Background task events
  | "checkpoint" // Checkpoint/memory events
  | "guardrail" // Guardrail events
  | "handoff" // Handoff events
  | "supervisor" // Supervisor events
  | "context" // Context management events
  | "error" // Error events
  | "stream"; // Stream events

/**
 * Event severity level for UI styling
 */
export type EventSeverity = "info" | "success" | "warning" | "error";

/**
 * Single event for display
 */
export interface EventDisplayInfo {
  /** Event type (e.g., "agent.thinking", "tool.call") */
  type: string;
  /** Display category */
  category: EventDisplayCategory;
  /** Event timestamp */
  timestamp: number;
  /** Associated agent name (if applicable) */
  agent?: string;
  /** Event payload data (sanitized) */
  data: Record<string, unknown>;
  /** Severity level for UI */
  severity: EventSeverity;
  /** Session ID */
  sessionId?: string;
  /** Turn ID */
  turnId?: string;
}

// =============================================================================
// Chat Display Types
// =============================================================================

/**
 * Message role for chat display
 */
export type ChatMessageRole = "user" | "assistant" | "system" | "tool";

/**
 * Single chat message for display
 */
export interface ChatMessageDisplayInfo {
  id: string;
  role: ChatMessageRole;
  content?: string;
  timestamp: number;
  toolCalls?: Array<{
    toolName: string;
    args: Record<string, unknown>;
  }>;
  toolResults?: Array<{
    toolName: string;
    result: unknown;
    isError?: boolean;
  }>;
}
