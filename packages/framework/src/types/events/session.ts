/**
 * Session, Turn, and Stream lifecycle events
 */

import type { TimestampedEvent } from "./base.ts";

export type SessionLifecycleEventType = "session.start" | "turn.start" | "turn.end" | "session.end";

export type SessionLifecycleTransition =
  | "session.start -> turn.start"
  | "turn.start -> turn.end"
  | "turn.end -> turn.start"
  | "turn.end -> session.end";

export interface SessionStartEvent extends TimestampedEvent<"session.start"> {
  readonly input?: string;
  readonly sessionId?: string;
}

export interface SessionEndEvent extends TimestampedEvent<"session.end"> {
  readonly output?: string;
  readonly sessionId?: string;
  readonly status?: "complete" | "failed" | "interrupted";
  readonly turns?: number;
}

export interface TurnStartEvent extends TimestampedEvent<"turn.start"> {
  readonly phase?: "planning" | "executing" | "summarizing";
  readonly turn: number;
  readonly turnId: string;
}

export interface TurnEndEvent extends TimestampedEvent<"turn.end"> {
  readonly status?: "completed" | "error" | "interrupted";
  readonly turn: number;
  readonly turnId: string;
}

export interface StreamStartEvent extends TimestampedEvent<"stream.start"> {
  readonly turn: number;
  readonly turnId?: string;
}

export interface StreamEndEvent extends TimestampedEvent<"stream.end"> {
  readonly turn: number;
  readonly turnId?: string;
}

export interface StreamChunkEvent extends TimestampedEvent<"stream.chunk"> {
  readonly content: string;
  readonly phase: "planning" | "executing" | "summarizing";
}
