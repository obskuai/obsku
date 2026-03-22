import type { EventDisplayCategory, EventSeverity } from "./types";

/**
 * Event type to display category mapping
 * Maps all 36+ CanonicalAgentEvent variants to UI-friendly categories
 */
export const EVENT_TYPE_TO_CATEGORY: Record<string, EventDisplayCategory> = {
  // Session lifecycle events (4)
  "session.start": "session",
  "session.end": "session",
  "turn.start": "session",
  "turn.end": "session",

  // Stream events (3)
  "stream.start": "stream",
  "stream.end": "stream",
  "stream.chunk": "stream",

  // Agent lifecycle events (4)
  "agent.thinking": "agent",
  "agent.transition": "agent",
  "agent.error": "agent",
  "agent.complete": "agent",

  // Tool events (4)
  "tool.call": "tool",
  "tool.result": "tool",
  "tool.progress": "tool",
  "tool.stream.chunk": "tool",

  // Graph events (6)
  "graph.node.start": "graph",
  "graph.node.complete": "graph",
  "graph.node.failed": "graph",
  "graph.cycle.start": "graph",
  "graph.cycle.complete": "graph",
  "graph.interrupt": "graph",

  // Background task events (4)
  "bg.task.started": "background",
  "bg.task.completed": "background",
  "bg.task.failed": "background",
  "bg.task.timeout": "background",

  // Checkpoint/memory events (3)
  "checkpoint.saved": "checkpoint",
  "memory.load": "checkpoint",
  "memory.save": "checkpoint",

  // Guardrail events (2)
  "guardrail.input.blocked": "guardrail",
  "guardrail.output.blocked": "guardrail",

  // Handoff events (2)
  "handoff.start": "handoff",
  "handoff.complete": "handoff",

  // Context events (2)
  "context.pruned": "context",
  "context.compacted": "context",

  // Supervisor events (4)
  "supervisor.routing": "supervisor",
  "supervisor.worker.output": "supervisor",
  "supervisor.finish": "supervisor",
  "supervisor.routing.failed": "supervisor",

  // Error events (2)
  "hook.error": "error",
  "parse.error": "error",
};

/**
 * Event type to severity mapping
 * Determines UI styling for each event type
 */
export const EVENT_TYPE_TO_SEVERITY: Record<string, EventSeverity> = {
  // Session - info
  "session.start": "info",
  "session.end": "info",
  "turn.start": "info",
  "turn.end": "success",

  // Stream - info
  "stream.start": "info",
  "stream.end": "success",
  "stream.chunk": "info",

  // Agent - info/success
  "agent.thinking": "info",
  "agent.transition": "info",
  "agent.error": "error",
  "agent.complete": "success",

  // Tool - info/success
  "tool.call": "info",
  "tool.result": "success",
  "tool.progress": "info",
  "tool.stream.chunk": "info",

  // Graph - info/success/error
  "graph.node.start": "info",
  "graph.node.complete": "success",
  "graph.node.failed": "error",
  "graph.cycle.start": "info",
  "graph.cycle.complete": "success",
  "graph.interrupt": "warning",

  // Background - info/success/error
  "bg.task.started": "info",
  "bg.task.completed": "success",
  "bg.task.failed": "error",
  "bg.task.timeout": "warning",

  // Checkpoint - info
  "checkpoint.saved": "info",
  "memory.load": "info",
  "memory.save": "info",

  // Guardrail - warning (blocked)
  "guardrail.input.blocked": "warning",
  "guardrail.output.blocked": "warning",

  // Handoff - info
  "handoff.start": "info",
  "handoff.complete": "success",

  // Context - info
  "context.pruned": "info",
  "context.compacted": "info",

  // Supervisor - info/success/error
  "supervisor.routing": "info",
  "supervisor.worker.output": "info",
  "supervisor.finish": "success",
  "supervisor.routing.failed": "error",

  // Error - error
  "hook.error": "error",
  "parse.error": "error",
};

/**
 * Get display category for an event type
 */
export function getEventCategory(eventType: string): EventDisplayCategory {
  return EVENT_TYPE_TO_CATEGORY[eventType] ?? "agent";
}

/**
 * Get severity level for an event type
 */
export function getEventSeverity(eventType: string): EventSeverity {
  return EVENT_TYPE_TO_SEVERITY[eventType] ?? "info";
}

/**
 * All known event types
 */
export const ALL_EVENT_TYPES = Object.keys(EVENT_TYPE_TO_CATEGORY);

/**
 * Event count by category (for UI statistics)
 */
export function countEventsByCategory(
  events: Array<{ type: string }>,
): Record<EventDisplayCategory, number> {
  const counts: Record<EventDisplayCategory, number> = {
    session: 0,
    agent: 0,
    tool: 0,
    graph: 0,
    background: 0,
    checkpoint: 0,
    guardrail: 0,
    handoff: 0,
    supervisor: 0,
    context: 0,
    error: 0,
    stream: 0,
  };

  for (const event of events) {
    const category = getEventCategory(event.type);
    counts[category]++;
  }

  return counts;
}
