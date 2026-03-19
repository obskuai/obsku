// =============================================================================
// @obsku/framework — Agent configuration type definitions
// Types used by agent definitions and runtime configuration
// =============================================================================

import type { CheckpointBackend } from "../checkpoint/index";
import type { MemoryProvider } from "../memory/types";
import type { AgentEvent } from "./events";
import type { LLMResponse, Message, ResponseFormat, ToolDef } from "./llm";
import type {
  Directive,
  Logger,
  PluginDef,
  PluginTruncationConfig,
  ToolMiddleware,
  TruncationConfig,
} from "./plugin-config";

// Re-export context window and memory configs from their specialized modules
export type { ContextWindowConfig } from "./context-window-config";
export type { MemoryConfig } from "./memory-config";

import type { ContextWindowConfig } from "./context-window-config";
import type { MemoryConfig } from "./memory-config";

// --- Runtime Context Types ---

export interface StepContext {
  iteration: number;
  lastResponse: LLMResponse;
  messages: ReadonlyArray<Message>;
  toolResults: ReadonlyArray<{ result: unknown; toolName: string }>;
}

export interface StepContext {
  iteration: number;
  lastResponse: LLMResponse;
  messages: ReadonlyArray<Message>;
  toolResults: ReadonlyArray<{ result: unknown; toolName: string }>;
}

export interface ToolResultContext {
  input: Record<string, unknown>;
  isError?: boolean;
  iteration: number;
  result: string;
  toolName: string;
}

export interface LLMCallContext {
  iteration: number;
  messages: Array<Message>;
  tools: Array<ToolDef>;
}

/**
 * Return value from beforeLLMCall hook to override messages/tools.
 * When provided, these values replace the original arrays.
 */
export interface BeforeLLMCallResult {
  messages?: Array<Message>;
  tools?: Array<ToolDef>;
}

export type GuardrailFn = (ctx: {
  input?: string;
  messages: Array<Message>;
  output?: string;
}) => Promise<{ allow: boolean; reason?: string }> | { allow: boolean; reason?: string };

export interface TelemetryConfig {
  enabled: boolean;
  serviceName?: string;
}

export interface PromptContext {
  input: string;
  messages: Array<Message>;
  sessionId?: string;
}

export interface AgentFactoryConfig {
  allowedChildTools?: Array<string>; // undefined means all parent tools available
  maxAgents?: number; // default: 10
  maxDepth?: number; // default: 5
}

// --- Agent Definition ---

import type { InternalPlugin } from "../plugin/index";

export interface AgentDef {
  afterLLMCall?: (ctx: LLMCallContext & { response: LLMResponse }) => void | Promise<void>;
  agentFactory?: boolean | AgentFactoryConfig;
  beforeLLMCall?: (
    ctx: LLMCallContext
  ) => void | BeforeLLMCallResult | Promise<void | BeforeLLMCallResult>;
  contextWindow?: ContextWindowConfig;
  directives?: Array<Directive>;
  guardrails?: {
    input?: Array<GuardrailFn>;
    output?: Array<GuardrailFn>;
  };
  handoffs?: Array<{ agent: AgentDef; description: string }>;
  logger?: Logger;
  maxIterations?: number; // default: 10
  memory?: MemoryConfig | MemoryProvider;
  name: string;
  onStepFinish?: (ctx: StepContext) => void | Promise<void>;
  onToolResult?: (ctx: ToolResultContext) => void | Promise<void>;
  pluginTruncation?: PluginTruncationConfig;
  prompt: string | ((ctx: PromptContext) => string | Promise<string>);
  stopWhen?: (ctx: StepContext) => boolean;
  streaming?: boolean; // default: false
  telemetry?: TelemetryConfig;
  toolConcurrency?: number; // default: 3
  toolMiddleware?: Array<ToolMiddleware>;
  tools?: Array<
    PluginDef | { middleware: Array<ToolMiddleware>; tool: PluginDef } | InternalPlugin
  >;
  toolTimeout?: number; // default: 30_000 ms
  truncation?: TruncationConfig;
}

// --- Agent Runtime Types ---

export interface ConversationMessage {
  content: string;
  role: "user" | "assistant";
}

export interface AgentRunOptions {
  checkpointStore?: CheckpointBackend;
  eventBusCapacity?: number;
  messages?: Array<ConversationMessage>;
  onEvent?: (event: AgentEvent) => void;
  responseFormat?: ResponseFormat;
  sessionId?: string;
}
