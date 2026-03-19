// =============================================================================
// @obsku/framework — Configuration type definitions (COMPATIBILITY BARREL)
// =============================================================================
//
// This file exists for backward compatibility.
// Types are now organized in:
//   - truncation-config.ts: Truncation and directive types
//   - context-window-config.ts: Context window management types
//   - memory-config.ts: Memory system configuration types
//   - plugin-config.ts: Plugin-facing types (tools, middleware, plugins)
//   - agent-config.ts: Agent/runtime types (agent config, runtime options)
//
// This barrel ensures existing imports continue to work.
//
// =============================================================================

// Re-export all agent/runtime types
export type {
  AgentDef,
  AgentFactoryConfig,
  AgentRunOptions,
  BeforeLLMCallResult,
  ConversationMessage,
  GuardrailFn,
  LLMCallContext,
  PromptContext,
  StepContext,
  TelemetryConfig,
  ToolResultContext,
} from "./agent-config";

export type { ContextWindowConfig } from "./context-window-config";

export type { MemoryConfig } from "./memory-config";

// Re-export all plugin-facing types
export type {
  ExecOpts,
  ExecResult,
  FetchOpts,
  Logger,
  ParamDef,
  PluginCtx,
  PluginDef,
  PluginRunOutput,
  ToolBinding,
  ToolCallContext,
  ToolMiddleware,
  ToolOutput,
  ToolResult,
} from "./plugin-config";
// Re-export from specialized config modules
export type {
  Directive,
  PluginTruncationConfig,
  TruncationConfig,
} from "./truncation-config";
