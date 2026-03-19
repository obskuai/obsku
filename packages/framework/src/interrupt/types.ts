/**
 * Interrupt types for graph execution
 *
 * Provides InterruptError for throwing interrupts and interrupt() helper.
 */

/**
 * Configuration for an interrupt event
 */
export interface InterruptConfig {
  /** Input type for the interrupt */
  inputType?: "text" | "select" | "confirm";
  /** Optional metadata for the interrupt */
  metadata?: Record<string, unknown>;
  /** Options for select input type */
  options?: Array<{
    description?: string;
    label: string;
    value: string;
  }>;
  /** Human-readable reason for the interrupt */
  reason: string;
  /** Whether this interrupt requires user input to resume */
  requiresInput?: boolean;
  /** Optional timeout in milliseconds (not used for event structure) */
  timeout?: number;
}

/**
 * Error thrown to interrupt graph execution
 *
 * Used for checkpoint/resume flow. The executor catches this,
 * saves state, and waits for user input or timeout.
 */
export class InterruptError extends Error {
  readonly _tag = "InterruptError" as const;

  constructor(readonly config: InterruptConfig) {
    super(`Interrupt: ${config.reason}`);
    this.name = "InterruptError";
  }
}

export function isInterruptError(error: unknown): error is InterruptError {
  return (
    error instanceof InterruptError ||
    (typeof error === "object" &&
      error !== null &&
      "_tag" in error &&
      (error as { _tag?: unknown })._tag === "InterruptError")
  );
}

/**
 * Throw an InterruptError to pause graph execution
 *
 * @param config - Interrupt configuration
 * @throws Always throws InterruptError
 */
export function interrupt(config: InterruptConfig): never {
  throw new InterruptError(config);
}
