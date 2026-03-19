import type { Message } from "../types";
import type { MemoryProvider } from "./types";

/**
 * In-memory implementation of MemoryProvider.
 * Stores conversation history in a Map with no persistence.
 * Suitable for testing and short-lived sessions.
 */
export class InMemoryProvider implements MemoryProvider {
  private storage = new Map<string, Array<Message>>();

  async load(sessionId: string): Promise<Array<Message>> {
    return this.storage.get(sessionId) ?? [];
  }

  async save(sessionId: string, messages: Array<Message>): Promise<void> {
    this.storage.set(sessionId, messages);
  }
}
