// =============================================================================
// @obsku/framework — Default timeout constants
// =============================================================================

/**
 * Centralized default timeout values for the framework.
 * All timeout magic numbers should reference these constants.
 */
export const DEFAULTS = {
  /** Milliseconds per second - for converting between ms and seconds */
  msPerSecond: 1000,

  /** Default thinking budget tokens for LLM providers that support extended thinking (4096) */
  thinkingBudgetTokens: 4096,

  /** Tokens to reserve for output in context window management (4096) */
  reserveOutputTokens: 4096,

  eventBusCapacity: 1024,
  /** Tool execution timeout (30 seconds) */
  toolTimeout: 30_000,
  /** Graph node execution timeout (5 minutes) */
  nodeTimeout: 300_000,
  /** Exec command timeout (30 seconds) */
  execTimeout: 30_000,
  /** Background task max lifetime (5 minutes) */
  taskMaxLifetime: 300_000,
  /** Background task retention after completion (60 seconds) */
  taskRetention: 60_000,
  /** Remote agent HTTP/ARN call timeout (5 minutes) */
  remoteAgentTimeout: 300_000,
  /** Recon tool availability check timeout (5 seconds) */
  reconToolCheckTimeout: 5000,
  /** Code interpreter Python session initialization timeout (5 seconds) */
  codeInterpreterPythonInitTimeout: 5000,
  /** Code interpreter JS/TS session initialization timeout (500ms) */
  codeInterpreterJsInitTimeout: 500,
  /** Process kill grace period timeout (1 second) */
  processKillGraceTimeout: 1000,
  /** Code interpreter session read timeout (30 seconds) */
  codeInterpreterSessionTimeout: 30_000,
  /** Code interpreter execution timeout (60 seconds) */
  codeInterpreterExecTimeout: 60_000,
  /** Code interpreter idle timeout (15 minutes) */
  codeInterpreterIdleTimeout: 900_000,
  /** Code interpreter max duration (60 minutes) */
  codeInterpreterMaxDuration: 3_600_000,

  /** Memory system defaults */
  memory: {
    /** Maximum context length for memory injection (2000 characters) */
    maxContextLength: 2000,
    /** Maximum entities per session to load (100) */
    maxEntitiesPerSession: 100,
    /** Maximum facts to inject into context (10) */
    maxFactsToInject: 10,
    /** Minimum confidence threshold for facts (0.7) */
    minFactConfidence: 0.7,
    /** Default confidence for facts when not specified (0.5) */
    defaultFactConfidence: 0.5,
    /** Semantic search similarity threshold (0.7) */
    semanticSearchThreshold: 0.7,
  },

  /** Context window management defaults */
  contextWindow: {
    /** Prune threshold as fraction of max context tokens (0.7) */
    pruneThreshold: 0.7,
    /** Compaction threshold as fraction of max context tokens (0.85) */
    compactionThreshold: 0.85,
    /** Number of recent message pairs to protect during pruning (3) */
    protectedRecentPairs: 3,
  },

  /** Compaction strategy defaults */
  compaction: {
    /** Number of recent messages to preserve during compaction (4) */
    recentMessagesBuffer: 4,
    /** Whether to preserve system messages during compaction */
    preserveSystemMessages: true,
  },

  /** Supervisor multi-agent defaults */
  supervisor: {
    /** Maximum preview length for worker output (200 characters) */
    outputPreviewLength: 200,
    /** Maximum preview length for worker prompts (100 characters) */
    promptPreviewLength: 100,
  },

  /** Server defaults */
  server: {
    /** Default port for AgentCore protocol (8080) */
    agentCorePort: 8080,
    /** Default port for A2A protocol (9000) */
    a2aPort: 9000,
    /** Default port for MCP protocol (3000) */
    mcpPort: 3000,
  },

  /** Model registry defaults */
  modelRegistry: {
    /** LiteLLM JSON URL */
    litellmUrl:
      "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
    /** Cache TTL (24 hours) */
    ttl: 24 * 60 * 60 * 1000,
    /** Fetch timeout (5 seconds) */
    fetchTimeout: 5000,
  },

  /** HTTP content type constants */
  http: {
    /** Content-Type for JSON data */
    jsonContentType: "application/json",
    /** Content-Type for binary/octet-stream data */
    binaryContentType: "application/octet-stream",
    /** Content-Type for SSE (text/event-stream) */
    sseContentType: "text/event-stream",
  },

  /** Agent factory defaults */
  agentFactory: {
    /** Maximum iterations for dynamically created sub-agents (10) */
    maxIterations: 10,
  },

  /** Preview truncation defaults for logging */
  preview: {
    /** Length for log message previews (200 characters) */
    logPreviewLength: 200,
    /** Length for Redis log previews (200 characters) */
    redisLogPreviewLength: 200,
    /** Length for short ID generation (8 characters) */
    shortIdLength: 8,
    /** Tool output truncation ratio as fraction of context window (0.05) */
    truncationRatio: 0.05,
  },
} as const;
