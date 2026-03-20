import type { LLMResponse } from "./types";

const STOP_REASONS: Record<string, LLMResponse["stopReason"]> = {
  end_turn: "end_turn",
  max_tokens: "max_tokens",
  stop_sequence: "stop_sequence",
  tool_use: "tool_use",
};

export function normalizeStopReason(reason: string | undefined): LLMResponse["stopReason"] {
  if (!reason) {
    return "end_turn";
  }
  return STOP_REASONS[reason] ?? "end_turn";
}

export function isAsyncIterable<T>(v: unknown): v is AsyncIterable<T> {
  return v != null && typeof v === "object" && Symbol.asyncIterator in v;
}

/**
 * Assert that a value is of type never (exhaustive switch check).
 * Throws an error at runtime if reached, and causes TypeScript compile error
 * if the switch is not exhaustive.
 * @param value - The value that should be of type never
 * @param msg - Optional error message
 * @returns never
 */
export function assertNever(value: never, msg?: string): never {
  throw new Error(msg ?? `Unexpected value: ${JSON.stringify(value)}`);
}
