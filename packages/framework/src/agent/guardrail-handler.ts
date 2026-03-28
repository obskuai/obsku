import { GuardrailError } from "../guardrails";
import type { AgentEvent } from "../types/index";

export function handleGuardrailError(
  error: unknown,
  emit: (event: AgentEvent) => void,
  direction: "input" | "output",
): void {
  if (error instanceof GuardrailError) {
    const eventType =
      direction === "input"
        ? "guardrail.input.blocked"
        : "guardrail.output.blocked";

    emit({
      reason: error.reason,
      timestamp: Date.now(),
      type: eventType,
    });

    emit({
      from: "Executing",
      timestamp: Date.now(),
      to: "Error",
      type: "agent.transition",
    });
  }
}
