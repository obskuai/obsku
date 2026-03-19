/**
 * Guardrail events
 */

import type { TimestampedEvent } from "./base.ts";

export interface GuardrailInputBlockedEvent extends TimestampedEvent<"guardrail.input.blocked"> {
  readonly reason: string;
}

export interface GuardrailOutputBlockedEvent extends TimestampedEvent<"guardrail.output.blocked"> {
  readonly reason: string;
}
