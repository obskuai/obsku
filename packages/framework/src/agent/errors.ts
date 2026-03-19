import { createTaggedError } from "../errors/tagged-error";

export class AgentValidationError extends createTaggedError("AgentValidationError") {
  constructor(
    readonly field: string,
    readonly actualType: string
  ) {
    super(`Invalid input: expected "${field}" to be a string, got ${actualType}`);
  }
}

export class AgentRecursionError extends createTaggedError("AgentRecursionError") {
  constructor(readonly maxDepth: number) {
    super(
      `Maximum agent delegation depth (${maxDepth}) exceeded. This may indicate an infinite recursion loop.`
    );
  }
}
