/**
 * Graph execution events
 */

import type { TimestampedEvent } from "./base.ts";

export interface GraphNodeStartEvent extends TimestampedEvent<"graph.node.start"> {
  readonly nodeId: string;
}

export interface GraphNodeCompleteEvent extends TimestampedEvent<"graph.node.complete"> {
  readonly duration: number;
  readonly nodeId: string;
  readonly result: unknown;
}

export interface GraphNodeFailedEvent extends TimestampedEvent<"graph.node.failed"> {
  readonly error: string;
  readonly nodeId: string;
}

export interface GraphCycleStartEvent extends TimestampedEvent<"graph.cycle.start"> {
  readonly from: string;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly to: string;
}

export interface GraphCycleCompleteEvent extends TimestampedEvent<"graph.cycle.complete"> {
  readonly from: string;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly to: string;
}

export interface GraphInterruptEvent extends TimestampedEvent<"graph.interrupt"> {
  readonly checkpointId?: string;
  readonly nodeId: string;
  readonly reason: string;
  readonly requiresInput: boolean;
}
