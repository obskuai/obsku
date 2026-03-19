import { createTaggedError } from "../errors/tagged-error";

export class TaskConcurrencyError extends createTaggedError("TaskConcurrencyError") {
  constructor(readonly maxConcurrent: number) {
    super(`Max concurrent background tasks (${maxConcurrent}) reached`);
  }
}
