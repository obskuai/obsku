// @obsku/adapter-claude-code — Error taxonomy
// All errors extend Error with _tag discriminant for exhaustive handling.

export class ClaudeNotFoundError extends Error {
  readonly _tag = "ClaudeNotFoundError" as const;
  constructor() {
    super("claude binary not found in PATH. Install Claude Code: https://claude.ai/code");
    this.name = "ClaudeNotFoundError";
  }
}

export class ClaudeTimeoutError extends Error {
  readonly _tag = "ClaudeTimeoutError" as const;
  constructor(readonly timeoutMs: number) {
    super(`claude invocation timed out after ${timeoutMs}ms`);
    this.name = "ClaudeTimeoutError";
  }
}

export class ClaudeCancelledError extends Error {
  readonly _tag = "ClaudeCancelledError" as const;
  constructor() {
    super("claude invocation cancelled");
    this.name = "ClaudeCancelledError";
  }
}

export class ClaudeNonZeroExitError extends Error {
  readonly _tag = "ClaudeNonZeroExitError" as const;
  constructor(readonly exitCode: number) {
    super(`claude exited with code ${exitCode}`);
    this.name = "ClaudeNonZeroExitError";
  }
}

export class ClaudeExecutionError extends Error {
  readonly _tag = "ClaudeExecutionError" as const;
  constructor(message: string) {
    super(`claude reported an error: ${message}`);
    this.name = "ClaudeExecutionError";
  }
}

export class ClaudeMalformedOutputError extends Error {
  readonly _tag = "ClaudeMalformedOutputError" as const;
  constructor(description: string) {
    super(`claude produced unexpected output: ${description}`);
    this.name = "ClaudeMalformedOutputError";
  }
}

export type ClaudeAdapterError =
  | ClaudeNotFoundError
  | ClaudeTimeoutError
  | ClaudeCancelledError
  | ClaudeNonZeroExitError
  | ClaudeExecutionError
  | ClaudeMalformedOutputError;
