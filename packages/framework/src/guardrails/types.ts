import type { Message } from "../types";

export interface GuardrailResult {
  allow: boolean;
  reason?: string;
}

export interface GuardrailContext {
  input?: string;
  messages: Array<Message>;
  output?: string;
}

export type GuardrailFn = (ctx: GuardrailContext) => Promise<GuardrailResult> | GuardrailResult;

export class GuardrailError extends Error {
  readonly _tag = "GuardrailError" as const;
  readonly reason: string;

  constructor(reason: string) {
    super(`Guardrail blocked: ${reason}`);
    this.reason = reason;
    this.name = "GuardrailError";
  }
}

export interface GuardrailsConfig {
  input?: Array<GuardrailFn>;
  output?: Array<GuardrailFn>;
}
