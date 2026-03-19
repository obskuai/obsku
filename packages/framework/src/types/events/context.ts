/**
 * Context management events
 */

import type { TimestampedEvent } from "./base.ts";

export interface ContextPrunedEvent extends TimestampedEvent<"context.pruned"> {
  readonly estimatedTokensSaved: number;
  readonly removedMessages: number;
}

export interface ContextCompactedEvent extends TimestampedEvent<"context.compacted"> {
  readonly compactedMessages: number;
  readonly estimatedTokensSaved: number;
  readonly originalMessages: number;
}
