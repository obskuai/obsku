/**
 * Supervisor multi-agent events
 */

import type { TimestampedEvent } from "./base.ts";

export interface SupervisorRoutingEvent extends TimestampedEvent<"supervisor.routing"> {
  readonly next: string;
  readonly round: number;
}

export interface SupervisorWorkerOutputEvent extends TimestampedEvent<"supervisor.worker.output"> {
  readonly output: string;
  readonly round: number;
  readonly worker: string;
}

export interface SupervisorFinishEvent extends TimestampedEvent<"supervisor.finish"> {
  readonly rounds: number;
}

export interface SupervisorRoutingFailedEvent
  extends TimestampedEvent<"supervisor.routing.failed"> {
  readonly next: string;
  readonly round: number;
}
