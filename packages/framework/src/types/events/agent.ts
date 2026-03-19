/**
 * Agent lifecycle events
 */

import type { AgentState, AgentUsage, TimestampedEvent } from "./base.ts";

export interface AgentThinkingEvent extends TimestampedEvent<"agent.thinking"> {
  readonly content: string;
}

export interface AgentTransitionEvent extends TimestampedEvent<"agent.transition"> {
  readonly from: AgentState;
  readonly to: AgentState;
}

export interface AgentErrorEvent extends TimestampedEvent<"agent.error"> {
  readonly message: string;
}

export interface AgentCompleteEvent extends TimestampedEvent<"agent.complete"> {
  readonly summary: string;
  readonly usage?: AgentUsage;
}
