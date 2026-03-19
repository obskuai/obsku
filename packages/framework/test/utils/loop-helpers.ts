import type { OnEntityExtractFn } from "../../src/agent/agent-loop";
import { runAgentLoopBase } from "../../src/agent/agent-loop";
import { nonStreamingStrategy } from "../../src/agent/react-loop";
import type { ResolvedTool } from "../../src/agent/setup";
import { streamingStrategy } from "../../src/agent/stream-loop";
import type { EmitFn } from "../../src/agent/tool-executor";
import type { ResolvedTruncation } from "../../src/agent/truncation-resolve";
import type { TaskManager } from "../../src/background";
import type { HandoffTarget } from "../../src/handoff/types";
import type { InternalPlugin } from "../../src/plugin";
import type { ObskuConfig } from "../../src/services/config";
import type { TelemetryConfig } from "../../src/telemetry/types";
import type {
  AgentDef,
  BeforeLLMCallResult,
  ContextWindowConfig,
  GuardrailFn,
  LLMCallContext,
  LLMProvider,
  LLMResponse,
  Message,
  ResponseFormat,
  StepContext,
  ToolDef,
  ToolResultContext,
} from "../../src/types";
import { defaultAgentDef, toResolvedTools } from "./helpers";

export function runReactLoop(
  messages: Array<Message>,
  toolDefs: Array<ToolDef>,
  resolvedTools: Map<string, InternalPlugin> | Map<string, ResolvedTool>,
  provider: LLMProvider,
  config: ObskuConfig,
  bgToolNames: Set<string>,
  taskManager: TaskManager | undefined,
  emit: EmitFn,
  stopWhen?: (ctx: StepContext) => boolean,
  onStepFinish?: (ctx: StepContext) => void | Promise<void>,
  outputGuardrails?: Array<GuardrailFn>,
  onToolResult?: (ctx: ToolResultContext) => void | Promise<void>,
  handoffTargets?: Array<HandoffTarget>,
  agentName?: string,
  sessionId?: string,
  telemetryConfig?: TelemetryConfig,
  beforeLLMCall?: (
    ctx: LLMCallContext
  ) => void | BeforeLLMCallResult | Promise<void | BeforeLLMCallResult>,
  afterLLMCall?: (ctx: LLMCallContext & { response: LLMResponse }) => void | Promise<void>,
  onEntityExtract?: OnEntityExtractFn,
  contextWindowConfig?: ContextWindowConfig,
  resolvedTruncation?: ResolvedTruncation,
  responseFormat?: ResponseFormat,
  def?: AgentDef
) {
  const normalizedResolvedTools = toResolvedTools(resolvedTools);
  const agentDef = def ?? { ...defaultAgentDef, name: agentName ?? defaultAgentDef.name };

  return runAgentLoopBase(nonStreamingStrategy, {
    afterLLMCall,
    agentName,
    beforeLLMCall,
    bgToolNames,
    config,
    contextWindowConfig,
    def: agentDef,
    emit,
    handoffTargets,
    messages,
    onEntityExtract,
    onStepFinish,
    onToolResult,
    outputGuardrails,
    provider,
    resolvedTools: normalizedResolvedTools,
    resolvedTruncation,
    responseFormat,
    sessionId,
    stopWhen,
    taskManager,
    telemetryConfig,
    toolDefs,
  });
}

export function runStreamReactLoop(
  messages: Array<Message>,
  toolDefs: Array<ToolDef>,
  resolvedTools: Map<string, InternalPlugin> | Map<string, ResolvedTool>,
  provider: LLMProvider,
  config: ObskuConfig,
  bgToolNames: Set<string>,
  taskManager: TaskManager | undefined,
  emit: EmitFn,
  stopWhen?: (ctx: StepContext) => boolean,
  onStepFinish?: (ctx: StepContext) => void | Promise<void>,
  outputGuardrails?: Array<GuardrailFn>,
  onToolResult?: (ctx: ToolResultContext) => void | Promise<void>,
  handoffTargets?: Array<HandoffTarget>,
  agentName?: string,
  sessionId?: string,
  telemetryConfig?: TelemetryConfig,
  beforeLLMCall?: (
    ctx: LLMCallContext
  ) => void | BeforeLLMCallResult | Promise<void | BeforeLLMCallResult>,
  afterLLMCall?: (ctx: LLMCallContext & { response: LLMResponse }) => void | Promise<void>,
  onEntityExtract?: OnEntityExtractFn,
  contextWindowConfig?: ContextWindowConfig,
  resolvedTruncation?: ResolvedTruncation,
  responseFormat?: ResponseFormat,
  def?: AgentDef
) {
  const normalizedResolvedTools = toResolvedTools(resolvedTools);
  const agentDef = def ?? { ...defaultAgentDef, name: agentName ?? defaultAgentDef.name };

  return runAgentLoopBase(streamingStrategy, {
    afterLLMCall,
    agentName,
    beforeLLMCall,
    bgToolNames,
    config,
    contextWindowConfig,
    def: agentDef,
    emit,
    handoffTargets,
    messages,
    onEntityExtract,
    onStepFinish,
    onToolResult,
    outputGuardrails,
    provider,
    resolvedTools: normalizedResolvedTools,
    resolvedTruncation,
    responseFormat,
    sessionId,
    stopWhen,
    taskManager,
    telemetryConfig,
    toolDefs,
  });
}
