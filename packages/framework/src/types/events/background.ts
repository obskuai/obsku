/**
 * Background task events
 */

import type { TimestampedEvent } from "./base.ts";

export interface BackgroundTaskStartedEvent extends TimestampedEvent<"bg.task.started"> {
  readonly taskId: string;
  readonly toolName: string;
}

export interface BackgroundTaskCompletedEvent extends TimestampedEvent<"bg.task.completed"> {
  readonly duration: number;
  readonly taskId: string;
  readonly toolName: string;
}

export interface BackgroundTaskFailedEvent extends TimestampedEvent<"bg.task.failed"> {
  readonly error: string;
  readonly taskId: string;
  readonly toolName: string;
}

export interface BackgroundTaskTimeoutEvent extends TimestampedEvent<"bg.task.timeout"> {
  readonly taskId: string;
  readonly toolName: string;
}
