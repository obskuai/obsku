/**
 * Base event types and utilities
 */

export interface TimestampedEvent<TType extends string> {
  readonly timestamp: number;
  readonly type: TType;
}

export type NormalizedAgentState =
  | "idle"
  | "planning"
  | "executing"
  | "summarizing"
  | "done"
  | "error";

type LegacyAgentState = Capitalize<NormalizedAgentState>;

export type AgentState = NormalizedAgentState | LegacyAgentState;

export interface AgentUsage {
  llmCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}
