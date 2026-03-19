import { SessionNotFoundError } from "../errors";
import type { StoredMessage } from "../types";
import type { InMemoryState } from "./types";

export function addMessage(
  state: InMemoryState,
  sessionId: string,
  message: Omit<StoredMessage, "id" | "createdAt">
): StoredMessage {
  const session = state.sessions.get(sessionId);
  if (!session) {
    throw new SessionNotFoundError(sessionId);
  }

  const counter = state.messageCounters.get(sessionId) ?? 1;
  const fullMessage: StoredMessage = {
    ...message,
    createdAt: Date.now(),
    id: counter,
    sessionId,
  };

  const sessionMessages = state.messages.get(sessionId) ?? [];
  sessionMessages.push(fullMessage);
  state.messages.set(sessionId, sessionMessages);
  state.messageCounters.set(sessionId, counter + 1);

  // CRITICAL: In-place mutation of session.updatedAt (side effect across domains)
  session.updatedAt = Date.now();

  return { ...fullMessage };
}

export function getMessages(
  state: InMemoryState,
  sessionId: string,
  options: { before?: number; limit?: number } = {}
): Array<StoredMessage> {
  const session = state.sessions.get(sessionId);
  if (!session) {
    throw new SessionNotFoundError(sessionId);
  }

  let sessionMessages = state.messages.get(sessionId) ?? [];

  // Filter by before timestamp if specified
  if (options.before !== undefined) {
    const before = options.before;
    sessionMessages = sessionMessages.filter((m) => m.createdAt < before);
  }

  // Sort by createdAt ascending (oldest first)
  sessionMessages = sessionMessages.sort((a, b) => a.createdAt - b.createdAt);

  // Apply limit if specified (LAST N messages via slice(-limit))
  if (options.limit !== undefined && options.limit > 0) {
    sessionMessages = sessionMessages.slice(-options.limit);
  }

  return sessionMessages.map((m) => ({ ...m }));
}
