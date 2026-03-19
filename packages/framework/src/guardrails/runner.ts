import type { Message } from "../types";
import { GuardrailError, type GuardrailFn, type GuardrailResult } from "./types";

async function runGuardrailsSequential(
  guardrails: Array<GuardrailFn>,
  ctx: { input?: string; messages: Array<Message>; output?: string }
): Promise<void> {
  for (const guardrail of guardrails) {
    const result: GuardrailResult = await guardrail(ctx);
    if (!result.allow) {
      throw new GuardrailError(result.reason ?? "Content blocked by guardrail");
    }
  }
}

export async function runInputGuardrails(
  input: string,
  guardrails: Array<GuardrailFn>,
  messages: Array<Message>
): Promise<void> {
  await runGuardrailsSequential(guardrails, { input, messages });
}

export async function runOutputGuardrails(
  output: string,
  guardrails: Array<GuardrailFn>,
  messages: Array<Message>
): Promise<void> {
  await runGuardrailsSequential(guardrails, { messages, output });
}
