import type { AgentEvent } from "../types/events";
import type { DefaultPublicPayload, OutputPolicy, OutputPolicyInput } from "./types";

/**
 * Transforms an AgentEvent into the default public payload format.
 * This is a **lossless transformation**: all canonical event fields are preserved
 * in the output payload.
 *
 * Structure: { type, timestamp, data } where data contains all remaining event fields.
 *
 * @param input - The output policy input containing the canonical event
 * @returns DefaultPublicPayload with lossless data preservation
 *
 * @example
 * Input event:
 * ```ts
 * {
 *   type: "tool.call",
 *   timestamp: 1710000000000,
 *   toolName: "search",
 *   toolUseId: "toolu_123",
 *   args: { query: "obsku" }
 * }
 * ```
 *
 * Output payload:
 * ```ts
 * {
 *   type: "tool.call",
 *   timestamp: 1710000000000,
 *   data: {
 *     toolName: "search",
 *     toolUseId: "toolu_123",
 *     args: { query: "obsku" }
 *   }
 * }
 * ```
 */
function toDefaultPublicPayload<TEvent extends AgentEvent>({
  event,
}: OutputPolicyInput<TEvent>): DefaultPublicPayload<TEvent> {
  const { type, timestamp, ...data } = event;

  return {
    type,
    timestamp,
    data,
  } as DefaultPublicPayload<TEvent>;
}

/**
 * Default output policy implementation.
 *
 * This policy provides a **lossless** transformation from canonical AgentEvent
 * to DefaultPublicPayload. All event fields are preserved in the output:
 * - `type` and `timestamp` are lifted to top-level fields
 * - All remaining fields are collected into the `data` property
 *
 * This policy is transport-agnostic. Adapters wrap this payload with protocol-specific
 * framing (JSON-RPC, SSE, etc.) without changing the core transformation.
 */
export const defaultPolicy: OutputPolicy = {
  emit(input) {
    return toDefaultPublicPayload(input);
  },
};
