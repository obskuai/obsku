import type { Checkpoint, CheckpointStore, Session, StoredMessage } from "./types";

/** Sort items by updatedAt descending (most recent first) */
function sortByUpdatedAt<T extends { updatedAt: number }>(items: T[]): T[] {
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export class CheckpointStoreHelpers {
  constructor(private store: CheckpointStore) {}

  /**
   * Resume most recent session (like `claude --continue`)
   * Returns the most recently updated session with its messages and latest checkpoint
   */
  async continueLatest(workspaceId?: string): Promise<{
    checkpoint: Checkpoint | null;
    messages: Array<StoredMessage>;
    session: Session;
  } | null> {
    const sessions = await this.store.listSessions(workspaceId);

    if (sessions.length === 0) {
      return null;
    }

    // Sort by updatedAt descending (most recent first)
    const sortedSessions = sortByUpdatedAt(sessions);
    const latestSession = sortedSessions[0];

    const [messages, checkpoint] = await Promise.all([
      this.store.getMessages(latestSession.id),
      this.store.getLatestCheckpoint(latestSession.id),
    ]);

    return {
      checkpoint,
      messages,
      session: latestSession,
    };
  }

  /**
   * Search sessions by title, directory, or ID
   * Case-insensitive substring matching
   */
  async searchSessions(query: string, workspaceId?: string): Promise<Array<Session>> {
    const sessions = await this.store.listSessions(workspaceId);
    const lowerQuery = query.toLowerCase();

    return sessions.filter((session) => {
      const titleMatch = session.title?.toLowerCase().includes(lowerQuery);
      const directoryMatch = session.directory.toLowerCase().includes(lowerQuery);
      const idMatch = session.id.toLowerCase().includes(lowerQuery);

      return titleMatch || directoryMatch || idMatch;
    });
  }

  /**
   * Get session summary for UI display
   * Returns session metadata along with message count, checkpoint count, and duration
   */
  async getSessionSummary(sessionId: string): Promise<{
    checkpointCount: number;
    duration: number;
    lastMessage: StoredMessage | null;
    messageCount: number;
    session: Session;
  } | null> {
    const session = await this.store.getSession(sessionId);

    if (!session) {
      return null;
    }

    const [messages, checkpoints] = await Promise.all([
      this.store.getMessages(sessionId),
      this.store.listCheckpoints(sessionId),
    ]);

    const messageCount = messages.length;
    const lastMessage =
      messages.length > 0 ? messages.sort((a, b) => b.createdAt - a.createdAt)[0] : null;
    const checkpointCount = checkpoints.length;
    const duration = session.updatedAt - session.createdAt;

    return {
      checkpointCount,
      duration,
      lastMessage,
      messageCount,
      session,
    };
  }

  /**
   * List sessions with summaries (for picker UI)
   * Returns sessions with message counts and last message timestamps
   */
  async listSessionsWithSummaries(
    workspaceId?: string,
    limit?: number
  ): Promise<
    Array<{
      lastMessageAt: number | null;
      messageCount: number;
      session: Session;
    }>
  > {
    const sessions = await this.store.listSessions(workspaceId);

    const sortedSessions = sortByUpdatedAt(sessions);

    // NOTE: N+1 クエリだが、セッション数が少ない現状では許容範囲。
    // パフォーマンス問題が発生した場合に batch API を検討する。
    const DEFAULT_SESSION_CAP = 50;
    const effectiveLimit = Math.min(limit ?? DEFAULT_SESSION_CAP, DEFAULT_SESSION_CAP);
    const limitedSessions =
      effectiveLimit > 0 ? sortedSessions.slice(0, effectiveLimit) : sortedSessions;

    // Get message counts and last message timestamps for each session
    const summaries = await Promise.all(
      limitedSessions.map(async (session) => {
        const messages = await this.store.getMessages(session.id);
        const messageCount = messages.length;
        const lastMessageAt =
          messages.length > 0 ? Math.max(...messages.map((m) => m.createdAt)) : null;

        return {
          lastMessageAt,
          messageCount,
          session,
        };
      })
    );

    return summaries;
  }
}
