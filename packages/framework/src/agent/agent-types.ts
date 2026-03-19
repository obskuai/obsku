import type { Effect } from "effect";
import type { AgentFactoryRegistry } from "../agent-factory/index";
import type { TaskManager } from "../background/index";
import type { CheckpointBackend } from "../checkpoint/index";
import type { HandoffTarget } from "../handoff/types";

import type { ObskuConfig } from "../services/config";
import type {
  AgentDef,
  AgentEvent,
  ContextWindowConfig,
  LLMProvider,
  LLMResponse,
  MemoryConfig,
  Message,
  ResponseFormat,
  ToolDef,
} from "../types/index";
import type { RunProgramParams } from "./run-program/index";
import type { ResolvedTool } from "./setup";
import type { resolveTruncation } from "./truncation-resolve";

export type AgentIdentity = {
  agentName: string;
  def: AgentDef;
};

export type ToolContext = {
  bgToolNames: Set<string>;
  resolvedTools: Map<string, ResolvedTool>;
  toolDefs: Array<ToolDef>;
};

export type MemoryContext = {
  memoryConfig: MemoryConfig | undefined;
  onEntityExtract: ((response: LLMResponse) => Promise<void>) | undefined;
};

export type LifecycleHooks = {
  afterLLMCall: AgentDef["afterLLMCall"];
  beforeLLMCall: AgentDef["beforeLLMCall"];
  onStepFinish: AgentDef["onStepFinish"];
  onToolResult: AgentDef["onToolResult"];
};

export type SessionContext = {
  checkpointStore: CheckpointBackend | undefined;
  sessionId: string | undefined;
};

export type PersistenceContext = SessionContext &
  Pick<AgentIdentity, "def"> & {
    effectivePrompt: string;
    emit: (event: AgentEvent) => Effect.Effect<boolean>;
    history: Array<Message>;
    input: string;
    memoryConfig: MemoryConfig | undefined;
    messages: Array<Message>;
    provider: LLMProvider;
  };

export type AgentLoopContext = AgentIdentity &
  ToolContext &
  MemoryContext &
  LifecycleHooks &
  SessionContext & {
    config: ObskuConfig;
    contextWindowConfig: ContextWindowConfig | undefined;
    emit: (event: AgentEvent) => Effect.Effect<boolean>;
    factoryRegistry?: AgentFactoryRegistry;
    handoffTargets: Array<HandoffTarget>;
    messages: Array<Message>;
    outputGuardrails: AgentDef["guardrails"] | undefined;
    provider: LLMProvider;
    resolvedTruncation: ReturnType<typeof resolveTruncation>;
    responseFormat: ResponseFormat | undefined;
    stopWhen: AgentDef["stopWhen"];
    taskManager: TaskManager | undefined;
    telemetryConfig: AgentDef["telemetry"];
  };

export type ExecutionContext = AgentIdentity &
  ToolContext &
  MemoryContext &
  LifecycleHooks &
  SessionContext & {
    config: ObskuConfig;
    contextWindowConfig: ContextWindowConfig | undefined;
    effectivePrompt: string;
    emit: (event: AgentEvent) => Effect.Effect<boolean>;
    factoryRegistry?: AgentFactoryRegistry;
    handoffTargets: Array<HandoffTarget>;
    history: Array<Message>;
    input: string;
    messages: Array<Message>;
    outputGuardrails: AgentDef["guardrails"] | undefined;
    provider: LLMProvider;
    resolvedTruncation: ReturnType<typeof resolveTruncation>;
    responseFormat: ResponseFormat | undefined;
    stopWhen: AgentDef["stopWhen"];
    taskManager: TaskManager | undefined;
    telemetryConfig: AgentDef["telemetry"];
  };

export type BuildExecutionContextArgs = {
  config: ObskuConfig;
  effectivePrompt: string;
  emit: (event: AgentEvent) => Effect.Effect<boolean>;
  history: Array<Message>;
  memoryConfig: MemoryConfig | undefined;
  messages: Array<Message>;
  onEntityExtract: ((response: LLMResponse) => Promise<void>) | undefined;
  params: RunProgramParams;
  resolvedTruncation: ReturnType<typeof resolveTruncation>;
};
