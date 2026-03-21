import type { AgentEvent } from "../types/events";
import type { OutputPolicy, OutputPolicyContext } from "./types";

type OutputSurface = OutputPolicyContext["surface"];

export function applyPolicy<TEvent extends AgentEvent, TPublicPayload>(
  event: TEvent,
  policy: OutputPolicy<TEvent, TPublicPayload>,
  context: OutputPolicyContext
): TPublicPayload {
  return policy.emit({
    context,
    event,
  });
}

export function createPolicyEmitter<TEvent extends AgentEvent, TPublicPayload>(
  policy: OutputPolicy<TEvent, TPublicPayload>,
  surface: OutputSurface
): (event: TEvent) => TPublicPayload {
  return (event) => applyPolicy(event, policy, { surface });
}

export function wrapCallback<TEvent extends AgentEvent, TPublicPayload, TResult>(
  callback: (payload: TPublicPayload) => TResult,
  policy: OutputPolicy<TEvent, TPublicPayload>,
  surface: OutputSurface
): (event: TEvent) => TResult {
  const emit = createPolicyEmitter(policy, surface);

  return (event) => callback(emit(event));
}

export async function* wrapAsyncIterable<TEvent extends AgentEvent, TPublicPayload>(
  iterable: AsyncIterable<TEvent>,
  policy: OutputPolicy<TEvent, TPublicPayload>,
  surface: OutputSurface
): AsyncIterable<TPublicPayload> {
  const emit = createPolicyEmitter(policy, surface);

  for await (const event of iterable) {
    yield emit(event);
  }
}
