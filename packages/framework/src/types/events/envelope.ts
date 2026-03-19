/**
 * SSE Event envelope types
 */

// Forward declaration - will be defined after all events are imported
export type CanonicalAgentEvent =
  | import("./session.ts").SessionStartEvent
  | import("./session.ts").SessionEndEvent
  | import("./session.ts").TurnStartEvent
  | import("./session.ts").TurnEndEvent
  | import("./agent.ts").AgentThinkingEvent
  | import("./tool.ts").ToolCallEvent
  | import("./tool.ts").ToolResultEvent
  | import("./tool.ts").ToolProgressEvent
  | import("./agent.ts").AgentTransitionEvent
  | import("./agent.ts").AgentErrorEvent
  | import("./agent.ts").AgentCompleteEvent
  | import("./session.ts").StreamStartEvent
  | import("./session.ts").StreamEndEvent
  | import("./session.ts").StreamChunkEvent
  | import("./tool.ts").ToolStreamChunkEvent
  | import("./graph.ts").GraphNodeStartEvent
  | import("./graph.ts").GraphNodeCompleteEvent
  | import("./graph.ts").GraphNodeFailedEvent
  | import("./graph.ts").GraphCycleStartEvent
  | import("./graph.ts").GraphCycleCompleteEvent
  | import("./graph.ts").GraphInterruptEvent
  | import("./background.ts").BackgroundTaskStartedEvent
  | import("./background.ts").BackgroundTaskCompletedEvent
  | import("./background.ts").BackgroundTaskFailedEvent
  | import("./background.ts").BackgroundTaskTimeoutEvent
  | import("./checkpoint.ts").CheckpointSavedEvent
  | import("./checkpoint.ts").MemoryLoadEvent
  | import("./checkpoint.ts").MemorySaveEvent
  | import("./guardrail.ts").GuardrailInputBlockedEvent
  | import("./guardrail.ts").GuardrailOutputBlockedEvent
  | import("./handoff.ts").HandoffStartEvent
  | import("./handoff.ts").HandoffCompleteEvent
  | import("./context.ts").ContextPrunedEvent
  | import("./context.ts").ContextCompactedEvent
  | import("./supervisor.ts").SupervisorRoutingEvent
  | import("./supervisor.ts").SupervisorWorkerOutputEvent
  | import("./supervisor.ts").SupervisorFinishEvent
  | import("./supervisor.ts").SupervisorRoutingFailedEvent
  | import("./error.ts").HookErrorEvent
  | import("./error.ts").ParseErrorEvent;

export type AgentEventType = CanonicalAgentEvent["type"];

export interface SseEventEnvelope<TData = unknown, TType extends string = AgentEventType> {
  readonly data: TData;
  readonly sessionId: string;
  readonly timestamp: number;
  readonly turnId?: string;
  readonly type: TType;
}

export type CanonicalSseEvent<TEvent extends CanonicalAgentEvent = CanonicalAgentEvent> =
  SseEventEnvelope<Omit<TEvent, "timestamp" | "type">, TEvent["type"]>;

export type AgentEvent = CanonicalAgentEvent;
