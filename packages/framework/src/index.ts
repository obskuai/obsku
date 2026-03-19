// ============================================================================
// CORE AGENT RUNTIME
// ============================================================================
export type { Agent } from "./agent";
/**
 * Create an Agent from a declarative definition.
 *
 * @example
 * ```ts
 * const assistant = agent({ name: "assistant", prompt: "You are helpful.", tools: [echo] })
 * const result = await assistant.run("Hello!", provider)
 * ```
 */
export { agent } from "./agent";
export { createReadToolOutputPlugin } from "./agent/read-tool-output";
export type { ResolvedTruncation } from "./agent/truncation-resolve";
export { resolveTruncation } from "./agent/truncation-resolve";
export { AgentFactoryRegistry, createExecuteAgentTool } from "./agent-factory/index";
export type { AgentLike } from "./as-plugin";
export { asPlugin } from "./as-plugin";
export type { TaskEntry, TaskManagerConfig, TaskState } from "./background";
export {
  buildBackgroundPlugin,
  buildGetResultPlugin,
  isBackground,
  TaskManager,
} from "./background";
// ============================================================================
// STORAGE, CHECKPOINTS, EMBEDDINGS, AND MEMORY
// ============================================================================
export { InMemoryBlobStore } from "./blob/in-memory";
export type { BlobStore } from "./blob/types";
export type {
  Checkpoint,
  CheckpointNodeResult,
  CheckpointBackend,
  CheckpointStore,
  DialectConfig,
  MemoryStore,
  Serializer,
  Session,
  SessionOptions,
  StoredMessage,
  StoredToolResult,
} from "./checkpoint";
export {
  AbstractSqlCheckpointStore,
  CheckpointNotFoundError,
  CheckpointSchema,
  CheckpointStoreHelpers,
  cosineSimilarity,
  deserializeEmbedding,
  EntityNotFoundError,
  EntitySchema,
  FactSchema,
  generateMigrationSql,
  InMemoryCheckpointStore,
  JsonPlusSerializer,
  POSTGRES_MIGRATIONS,
  parseStoredMessage,
  postgresDialect,
  SessionNotFoundError,
  SessionSchema,
  SQLITE_MIGRATIONS,
  StoredMessageSchema,
  serializeEmbedding,
  sqliteDialect,
  VectorDimensionError,
  validate,
} from "./checkpoint";
export {
  mapCheckpointRow,
  mapEntityRow,
  mapFactRow,
  mapMessageRow,
  mapSessionRow,
} from "./checkpoint/ops/base-mappers";
export { forkFromCheckpoint } from "./checkpoint/ops/fork";
export {
  buildEntity,
  buildFact,
  buildFilterConditions,
  buildSession,
  validateEntityExists,
} from "./checkpoint/ops/shared-helpers";
export {
  sqlGetCheckpoint,
  sqlGetLatestCheckpoint,
  sqlListCheckpoints,
  sqlSaveCheckpoint,
} from "./checkpoint/ops/sql-checkpoint-ops";
export {
  sqlDeleteEntity,
  sqlGetEntityById,
  sqlListEntities,
  sqlSaveEntity,
  sqlUpdateEntity,
} from "./checkpoint/ops/sql-entity-ops";
export {
  sqlDeleteFact,
  sqlGetFact,
  sqlListFacts,
  sqlSaveFact,
} from "./checkpoint/ops/sql-fact-ops";
export { sqlAddMessage, sqlGetMessages } from "./checkpoint/ops/sql-message-ops";
export {
  sqlSearchEntitiesSemantic,
  sqlSearchFactsSemantic,
} from "./checkpoint/ops/sql-search-ops";
export {
  sqlCreateSession,
  sqlDeleteSession,
  sqlGetSession,
  sqlListSessions,
  sqlUpdateSession,
} from "./checkpoint/ops/sql-session-ops";
export type { SqlExecutor } from "./checkpoint/ops/sql-types";
export { DEFAULTS } from "./defaults";
export type {
  EmbedBatchResult,
  EmbeddingConfig,
  EmbeddingProvider,
  EmbedOptions,
  EmbedResult,
} from "./embeddings";
export { ExecTimeoutError } from "./exec";
// ============================================================================
// ORCHESTRATION, CONTROL FLOW, AND MULTI-AGENT
// ============================================================================
export { GraphValidationError } from "./graph/builder";
/**
 * Build and validate a DAG computation graph from nodes and edges.
 * Validates entry existence, edge references, cycles, and orphan nodes.
 *
 * @example
 * ```ts
 * const pipeline = graph({
 *   provider,
 *   entry: "planner",
 *   nodes: [{ id: "planner", executor: plannerAgent }],
 *   edges: [{ from: "planner", to: "executor" }],
 * })
 * ```
 */
export { graph } from "./graph/builder";
export { resumeGraph } from "./graph/resume";
export type {
  Graph,
  GraphConfig,
  GraphEdge,
  GraphInput,
  GraphNode,
  GraphStatus,
  NodeResult,
  NodeStatus,
} from "./graph/types";
export { DEFAULT_GRAPH_CONFIG } from "./graph/types";
export type { GuardrailContext, GuardrailResult, GuardrailsConfig } from "./guardrails";
export { GuardrailError, runInputGuardrails, runOutputGuardrails } from "./guardrails";
export type { HandoffTarget } from "./handoff";
export type { InterruptConfig } from "./interrupt/types";
export { InterruptError, interrupt, isInterruptError } from "./interrupt/types";
// ============================================================================
// PLUGINS, MCP, AND STRUCTURED OUTPUT
// ============================================================================
export type { McpHostServerConfig, McpServerConfig } from "./mcp";
export { createMcpClient, createMcpServer, mcpToPlugins } from "./mcp";
export type {
  Entity,
  Fact,
  ListEntitiesOptions,
  ListFactsOptions,
  MemoryHookContext,
  MemoryHooks,
  MemoryInjection,
  MemoryProvider,
  MemoryStoreOperations,
  Relationship,
  SemanticSearchOptions,
} from "./memory";
export {
  CONVERSATION_SUMMARY_PROMPT,
  defaultOnEntityExtract,
  defaultOnMemoryLoad,
  defaultOnMemorySave,
  ENTITY_EXTRACTION_PROMPT,
  FACT_EXTRACTION_PROMPT,
  InMemoryProvider,
} from "./memory";
export type { CrewConfig, CrewMember } from "./multi-agent/crew";
/**
 * Build a crew of agents that execute sequentially or hierarchically.
 * Sequential mode chains agents in order; hierarchical mode uses a supervisor.
 *
 * @example
 * ```ts
 * const scanCrew = crew({
 *   provider,
 *   name: "security-scan",
 *   process: "sequential",
 *   members: [{ agent: reconAgent, task: "Recon" }],
 * })
 * ```
 */
export { crew } from "./multi-agent/crew";
export type { SupervisorConfig } from "./multi-agent/supervisor";
/**
 * Create a supervisor that delegates tasks to worker agents in a routing loop.
 * The supervisor LLM picks which worker to invoke each round, or returns FINISH.
 *
 * @example
 * ```ts
 * const coord = supervisor({
 *   provider,
 *   name: "coordinator",
 *   workers: [researcherAgent, analyzerAgent],
 * })
 * ```
 */
export { supervisor } from "./multi-agent/supervisor";
export type { InternalPlugin } from "./plugin";
/**
 * Create a plugin (tool) from a declarative definition.
 * Handles param validation, auto-serialization, and error capture.
 *
 * @example
 * ```ts
 * const echo = plugin({
 *   name: "echo",
 *   description: "Echo text",
 *   params: z.object({ text: z.string() }),
 *   run: async ({ text }) => text,
 * })
 * ```
 */
export { ParamValidationError, PluginExecError, plugin } from "./plugin";
export type {
  RemoteAgentArnConfig,
  RemoteAgentConfig,
  RemoteAgentUrlConfig,
} from "./remote-agent";
export { asRemoteAgent, JsonRpcError, RemoteAgentError } from "./remote-agent";
export type { RunOptions } from "./runtime";
/**
 * Execute a computation graph and return the final result.
 * Supports checkpointing, event streaming, and resume-from-checkpoint.
 *
 * @example
 * ```ts
 * const result = await run(pipeline, {
 *   input: "Scan example.com",
 *   onEvent: (e) => console.log(e.type),
 * })
 * ```
 */
export { run } from "./runtime";
// ============================================================================
// SECURITY SUBPATH RE-EXPORTS
// ============================================================================
export * from "./security/index";

// ============================================================================
// SERVICES AND OBSERVABILITY
// ============================================================================
export type { ObskuConfig } from "./services/config";
export { ConfigLive, ConfigService } from "./services/config";
export type { EventBusService } from "./services/event-bus";
export { EventBus, EventBusLive } from "./services/event-bus";
export { StructuredOutputError, structuredAgent, zodToJsonSchema } from "./structured";
export type { JsonSchema } from "./types/json-schema";
export type { GenAiAttributes, SpanRecord } from "./telemetry";
export {
  addSpanAttributes,
  clearRecordedSpans,
  getRecordedSpans,
  debugLog,
  withSpan,
} from "./telemetry";
export {
  instrumentCheckpoint,
  instrumentLLMCall,
  instrumentToolExecution,
} from "./telemetry/instrument";
export type { TelemetrySetupOptions } from "./telemetry/setup";
export { setupTelemetry, shutdownTelemetry } from "./telemetry/setup";
export * from "./types/compaction";
// ============================================================================
// PUBLIC FRAMEWORK TYPES
// ============================================================================
export type {
  AgentDef,
  AgentFactoryConfig,
  AgentRunOptions,
  BeforeLLMCallResult,
  ContextWindowConfig,
  ConversationMessage,
  Directive,
  ExecOpts,
  ExecResult,
  FetchOpts,
  GuardrailFn,
  LLMCallContext,
  Logger,
  MemoryConfig,
  ParamDef,
  PluginCtx,
  PluginDef,
  PluginRunOutput,
  PluginTruncationConfig,
  PromptContext,
  StepContext,
  TelemetryConfig,
  ToolBinding,
  ToolCallContext,
  ToolMiddleware,
  ToolOutput,
  ToolResult,
  ToolResultContext,
  TruncationConfig,
} from "./types/config";
export * from "./types/constants";
export * from "./types/events/index";
export * from "./types/llm";
export * from "./types/provider-error";
export * from "./types/providers";
// ============================================================================
// ERROR UTILITIES
// ============================================================================
export {
  classifyError,
  getErrorMessage,
  getErrorStack,
  isRetryEligible,
  NETWORK_ERROR_CODES,
  toErrorRecord,
} from "./error-utils";
export type { ErrorClass } from "./error-utils";

// ============================================================================
// UTILITIES AND PROVIDER WRAPPERS
// ============================================================================
export {
  assertNever,
  generateId,
  isAsyncIterable,
  isRecord,
  isToolOutput,
  normalizeStopReason,
  normalizeToolResultBoundary,
  safeJsonParse,
  toToolResultEnvelope,
} from "./utils";
export type { EnvFilterOptions } from "./utils/env-filter";
export {
  DEFAULT_BLOCKLIST_PATTERNS,
  escapeRegex,
  filterEnvVars,
  matchesPattern,
} from "./utils/env-filter";

export type { ProviderHooks } from "./wrap-provider";
export { wrapProvider } from "./wrap-provider";
