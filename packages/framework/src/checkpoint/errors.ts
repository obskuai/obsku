import { DEFAULTS } from "../defaults";
import { createTaggedError } from "../errors/tagged-error";

export class SessionNotFoundError extends createTaggedError("SessionNotFoundError") {
  constructor(id: string) {
    super(`Session not found: ${id}`);
  }
}

export class CheckpointNotFoundError extends createTaggedError("CheckpointNotFoundError") {
  constructor(id: string) {
    super(`Checkpoint not found: ${id}`);
  }
}

export class EntityNotFoundError extends createTaggedError("EntityNotFoundError") {
  constructor(id: string) {
    super(`Entity not found: ${id}`);
  }
}

export class CheckpointCorruptionError extends createTaggedError("CheckpointCorruptionError") {
  constructor(dataPreview: string, cause?: unknown) {
    const truncated =
      dataPreview.length > DEFAULTS.preview.logPreviewLength
        ? `${dataPreview.slice(0, DEFAULTS.preview.logPreviewLength)}...`
        : dataPreview;
    super(`Checkpoint data is corrupted or invalid: ${truncated}`);
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}
