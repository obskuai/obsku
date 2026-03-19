import { getErrorMessage } from "@obsku/framework";
import type { ExecutorStage } from "./types";

export class ExecutorStageError extends Error {
  constructor(
    public readonly stage: ExecutorStage,
    cause: unknown
  ) {
    super(getErrorMessage(cause));
    this.name = "ExecutorStageError";
  }
}

export function rethrowStageError(stage: ExecutorStage, error: unknown): never {
  if (error instanceof ExecutorStageError) {
    throw error;
  }
  throw new ExecutorStageError(stage, error);
}
