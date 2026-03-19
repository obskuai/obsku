/**
 * Handoff events for multi-agent transitions
 */

import type { TimestampedEvent } from "./base.ts";

export interface HandoffStartEvent extends TimestampedEvent<"handoff.start"> {
  readonly fromAgent: string;
  readonly toAgent: string;
}

export interface HandoffCompleteEvent extends TimestampedEvent<"handoff.complete"> {
  readonly agent: string;
  readonly result: string;
}
