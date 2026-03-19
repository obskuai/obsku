import type { EmbeddingProvider } from "../../embeddings/types";
import type { Message } from "../../types/llm";
import type { MemoryStoreOperations } from "./store-ops";

/**
 * Context provided to memory hooks during execution.
 */
export interface MemoryHookContext {
  /** Name of the agent executing */
  agentName: string;
  /** Optional embedding provider for semantic search */
  embeddingProvider?: EmbeddingProvider;
  /** Optional input query for semantic search in onMemoryLoad */
  input?: string;
  /** Conversation messages so far */
  messages: Array<Message>;
  /** Current session ID */
  sessionId: string;
  /** Memory store for persistence operations */
  store: MemoryStoreOperations;
  /** Optional workspace ID for cross-session memory */
  workspaceId?: string;
}
