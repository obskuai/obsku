import type { AgentEvent } from "../types/events";

/**
 * Identifies which public event surface is consuming policy output.
 */
export interface OutputPolicyContext {
  readonly surface: "callback" | "iterable" | "transport";
}

/**
 * Canonical event plus delivery context passed into an output policy.
 */
export interface OutputPolicyInput<TEvent extends AgentEvent = AgentEvent> {
  readonly event: TEvent;
  readonly context: OutputPolicyContext;
}

/**
 * Default transport-agnostic public payload shape.
 */
export type DefaultPublicPayload<TEvent extends AgentEvent = AgentEvent> = TEvent extends AgentEvent
  ? {
      readonly type: TEvent["type"];
      readonly timestamp: number;
      readonly data: Omit<TEvent, "type" | "timestamp">;
    }
  : never;

/**
 * Maps a canonical framework event to a public payload.
 */
export interface OutputPolicy<
  TEvent extends AgentEvent = AgentEvent,
  TPublicPayload = DefaultPublicPayload<TEvent>,
> {
  emit(input: OutputPolicyInput<TEvent>): TPublicPayload;
}

export interface OutputPolicyFactory<
  TEvent extends AgentEvent = AgentEvent,
  TPublicPayload = DefaultPublicPayload<TEvent>,
> {
  create(): OutputPolicy<TEvent, TPublicPayload>;
}

/**
 * Extracts the public callback payload type from an output policy.
 * Used for typing `onEvent` callbacks in public APIs.
 */
export type CallbackPayload<TPolicy extends OutputPolicy> =
  TPolicy extends OutputPolicy<infer _TEvent, infer TPublicPayload> ? TPublicPayload : never;

/**
 * Extracts the public iterable payload type from an output policy.
 * Used for typing async iterables returned by `subscribe()` in public APIs.
 */
export type IterablePayload<TPolicy extends OutputPolicy> =
  TPolicy extends OutputPolicy<infer _TEvent, infer TPublicPayload> ? TPublicPayload : never;
