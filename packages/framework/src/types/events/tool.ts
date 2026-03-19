/**
 * Tool execution events
 */

import type { TimestampedEvent } from "./base.ts";

export interface ToolCallEvent extends TimestampedEvent<"tool.call"> {
  readonly args: Record<string, unknown>;
  readonly toolName: string;
  readonly toolUseId: string;
}

export interface ToolResultEvent extends TimestampedEvent<"tool.result"> {
  readonly isError?: boolean;
  readonly result: unknown;
  readonly toolName: string;
  readonly toolUseId: string;
}

export interface ToolProgressEvent extends TimestampedEvent<"tool.progress"> {
  readonly current?: number;
  readonly message?: string;
  readonly percent?: number;
  readonly stage?: string;
  readonly status?: "completed" | "running" | "waiting";
  readonly toolName: string;
  readonly toolUseId: string;
  readonly total?: number;
}

export interface ToolStreamChunkEvent extends TimestampedEvent<"tool.stream.chunk"> {
  readonly chunk: unknown;
  readonly toolName: string;
}
