import crypto from "node:crypto";
import { SessionNotFoundError } from "../errors";
import type { Checkpoint } from "../types";
import type { InMemoryState } from "./types";

function filterAndSortCheckpoints(
  checkpoints: Iterable<Checkpoint>,
  sessionId: string,
  namespace?: string
): Array<Checkpoint> {
  return Array.from(checkpoints)
    .filter(
      (c) => c.sessionId === sessionId && (namespace === undefined || c.namespace === namespace)
    )
    .sort((a, b) => b.step - a.step || b.createdAt - a.createdAt);
}
export function saveCheckpoint(
  state: InMemoryState,
  checkpoint: Omit<Checkpoint, "id" | "createdAt">
): Checkpoint {
  const session = state.sessions.get(checkpoint.sessionId);
  if (!session) {
    throw new SessionNotFoundError(checkpoint.sessionId);
  }

  const fullCheckpoint: Checkpoint = {
    ...checkpoint,
    createdAt: Date.now(),
    id: crypto.randomUUID(),
  };

  state.checkpoints.set(fullCheckpoint.id, fullCheckpoint);

  return { ...fullCheckpoint };
}

export function getCheckpoint(state: InMemoryState, checkpointId: string): Checkpoint | null {
  const checkpoint = state.checkpoints.get(checkpointId);
  return checkpoint ? { ...checkpoint } : null;
}

export function getLatestCheckpoint(
  state: InMemoryState,
  sessionId: string,
  namespace?: string
): Checkpoint | null {
  const session = state.sessions.get(sessionId);
  if (!session) {
    return null;
  }

  const sessionCheckpoints = filterAndSortCheckpoints(
    state.checkpoints.values(),
    sessionId,
    namespace
  );

  if (sessionCheckpoints.length === 0) {
    return null;
  }

  return { ...sessionCheckpoints[0] };
}

export function listCheckpoints(
  state: InMemoryState,
  sessionId: string,
  options: { limit?: number; namespace?: string } = {}
): Array<Checkpoint> {
  const session = state.sessions.get(sessionId);
  if (!session) {
    throw new SessionNotFoundError(sessionId);
  }

  let sessionCheckpoints = filterAndSortCheckpoints(
    state.checkpoints.values(),
    sessionId,
    options.namespace
  );

  if (options.limit !== undefined && options.limit > 0) {
    sessionCheckpoints = sessionCheckpoints.slice(0, options.limit);
  }

  return sessionCheckpoints.map((c) => ({ ...c }));
}
