/**
 * Checkpoint and Memory events
 */

import type { TimestampedEvent } from "./base.ts";

export interface CheckpointSavedEvent extends TimestampedEvent<"checkpoint.saved"> {
  readonly checkpointId: string;
  readonly namespace?: string;
  readonly nodeId?: string;
  readonly source?: string;
  readonly step?: number;
}

export interface MemoryLoadEvent extends TimestampedEvent<"memory.load"> {
  readonly messageCount: number;
  readonly sessionId: string;
}

export interface MemorySaveEvent extends TimestampedEvent<"memory.save"> {
  readonly messageCount: number;
  readonly sessionId: string;
}
