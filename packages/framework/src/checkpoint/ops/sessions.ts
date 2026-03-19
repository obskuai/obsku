import crypto from "node:crypto";
import { SessionNotFoundError } from "../errors";
import type { Session, SessionOptions } from "../types";
import type { InMemoryState } from "./types";

export function createSession(
  state: InMemoryState,
  directory: string,
  options: SessionOptions = {}
): Session {
  const now = Date.now();
  const session: Session = {
    createdAt: now,
    directory,
    id: crypto.randomUUID(),
    metadata: options.metadata,
    title: options.title,
    updatedAt: now,
    workspaceId: options.workspaceId,
  };

  state.sessions.set(session.id, session);
  state.messages.set(session.id, []);
  state.messageCounters.set(session.id, 1);

  return session;
}

export function getSession(state: InMemoryState, sessionId: string): Session | null {
  const session = state.sessions.get(sessionId);
  return session ? { ...session } : null;
}

export function listSessions(state: InMemoryState, workspaceId?: string): Array<Session> {
  const sessions = Array.from(state.sessions.values());
  const filtered = workspaceId ? sessions.filter((s) => s.workspaceId === workspaceId) : sessions;
  return filtered.map((s) => ({ ...s }));
}

export function updateSession(
  state: InMemoryState,
  sessionId: string,
  updates: Partial<Session>
): void {
  const session = state.sessions.get(sessionId);
  if (!session) {
    throw new SessionNotFoundError(sessionId);
  }

  Object.assign(session, updates, { updatedAt: Date.now() });
}

export function deleteSession(state: InMemoryState, sessionId: string): void {
  state.sessions.delete(sessionId);
  state.messages.delete(sessionId);
  state.messageCounters.delete(sessionId);

  // Clean up checkpoints for this session
  for (const [id, checkpoint] of state.checkpoints) {
    if (checkpoint.sessionId === sessionId) {
      state.checkpoints.delete(id);
    }
  }
}
