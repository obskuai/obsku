/**
 * Legacy event types for backward compatibility
 */

import type {
  AgentCompleteEvent,
  AgentErrorEvent,
  AgentThinkingEvent,
  AgentTransitionEvent,
} from "./agent.ts";
import type { LegacyJoin, LegacyUnderscore } from "./base.ts";
import type { ContextCompactedEvent, ContextPrunedEvent } from "./context.ts";
import type { StreamChunkEvent, StreamEndEvent, StreamStartEvent } from "./session.ts";
import type { SupervisorWorkerOutputEvent } from "./supervisor.ts";
import type { ToolCallEvent, ToolResultEvent } from "./tool.ts";

type LegacyPlannerThinkingType = LegacyJoin<"planner", "thinking">;
type LegacyToolCallingType = LegacyJoin<"tool", "calling">;
type LegacyToolResultType = LegacyJoin<"tool", "result">;
type LegacyAgentTransitionType = LegacyJoin<"agent", "transition">;
type LegacyErrorType = Capitalize<"error">;
type LegacyCompleteType = Capitalize<"complete">;
type LegacyStreamStartType = LegacyJoin<"stream", "start">;
type LegacyStreamEndType = LegacyJoin<"stream", "end">;
type LegacyStreamChunkType = LegacyJoin<"stream", "chunk">;
type LegacyContextPrunedType = LegacyJoin<"context", "pruned">;
type LegacyContextCompactedType = LegacyJoin<"context", "compacted">;
type LegacySupervisorWorkerOutputType = `supervisor.worker${LegacyUnderscore}output`;

export interface LegacyPlannerThinkingEvent extends Omit<AgentThinkingEvent, "type"> {
  readonly type: LegacyPlannerThinkingType;
}

export interface LegacyToolCallingEvent extends Omit<ToolCallEvent, "type"> {
  readonly type: LegacyToolCallingType;
}

export interface LegacyToolResultEvent extends Omit<ToolResultEvent, "type"> {
  readonly type: LegacyToolResultType;
}

export interface LegacyAgentTransitionEvent extends Omit<AgentTransitionEvent, "type"> {
  readonly type: LegacyAgentTransitionType;
}

export interface LegacyAgentErrorEvent extends Omit<AgentErrorEvent, "type"> {
  readonly type: LegacyErrorType;
}

export interface LegacyAgentCompleteEvent extends Omit<AgentCompleteEvent, "type"> {
  readonly type: LegacyCompleteType;
}

export interface LegacyStreamStartEvent extends Omit<StreamStartEvent, "type"> {
  readonly type: LegacyStreamStartType;
}

export interface LegacyStreamEndEvent extends Omit<StreamEndEvent, "type"> {
  readonly type: LegacyStreamEndType;
}

export interface LegacyStreamChunkEvent extends Omit<StreamChunkEvent, "type"> {
  readonly type: LegacyStreamChunkType;
}

export interface LegacyContextPrunedEvent extends Omit<ContextPrunedEvent, "type" | "timestamp"> {
  readonly type: LegacyContextPrunedType;
}

export interface LegacyContextCompactedEvent
  extends Omit<ContextCompactedEvent, "type" | "timestamp"> {
  readonly type: LegacyContextCompactedType;
}

export interface LegacySupervisorWorkerOutputEvent
  extends Omit<SupervisorWorkerOutputEvent, "type"> {
  readonly type: LegacySupervisorWorkerOutputType;
}

export type LegacyAgentEvent =
  | LegacyPlannerThinkingEvent
  | LegacyToolCallingEvent
  | LegacyToolResultEvent
  | LegacyAgentTransitionEvent
  | LegacyAgentErrorEvent
  | LegacyAgentCompleteEvent
  | LegacyStreamStartEvent
  | LegacyStreamEndEvent
  | LegacyStreamChunkEvent
  | LegacyContextPrunedEvent
  | LegacyContextCompactedEvent
  | LegacySupervisorWorkerOutputEvent;

// Type aliases for backward compatibility
export type PlannerThinking = LegacyPlannerThinkingEvent;
export type ToolCalling = LegacyToolCallingEvent;
export type LegacyToolResult = LegacyToolResultEvent;
export type AgentTransition = LegacyAgentTransitionEvent;
export type AgentError = LegacyAgentErrorEvent;
export type AgentComplete = LegacyAgentCompleteEvent;
export type StreamStart = LegacyStreamStartEvent;
export type StreamEnd = LegacyStreamEndEvent;
export type StreamChunk = LegacyStreamChunkEvent;
