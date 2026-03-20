import type { Message } from "../../types/llm";

/**
 * MemoryProvider interface for pluggable conversation memory.
 * Implementations can store conversation history in memory, databases,
 * vector stores, or any other persistence layer.
 */
export interface MemoryProvider {
  /**
   * Load conversation history for a session.
   * @param sessionId - Unique identifier for the conversation session
   * @returns Promise resolving to array of messages, or empty array if session doesn't exist
   */
  load(sessionId: string): Promise<Array<Message>>;

  /**
   * Save conversation history for a session.
   * @param sessionId - Unique identifier for the conversation session
   * @param messages - Array of messages to store
   * @returns Promise that resolves when storage is complete
   */
  save(sessionId: string, messages: Array<Message>): Promise<void>;
}
