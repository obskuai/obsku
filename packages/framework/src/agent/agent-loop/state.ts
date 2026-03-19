import type { TaskManager } from "../../background/index";
import type { HandoffTarget } from "../../handoff/types";
import type { InternalPlugin } from "../../plugin/index";
import type { ObskuConfig } from "../../services/config";
import type { AgentUsage } from "../../types/events/index";
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
  TelemetryConfig,
  ToolDef,
  ToolResultContext,
} from "../../types/index";
import type { ContextWindowManager } from "../context-window";
import type { LLMCallStrategy } from "../llm-phase";
import type { EmitFn } from "../tool-executor";
import type { ResolvedTruncation } from "../truncation-resolve";

export type OnEntityExtractFn = (response: LLMResponse) => void | Promise<void>;

export interface AgentLoopParams {
  afterLLMCall?: (ctx: LLMCallContext & { response: LLMResponse }) => void | Promise<void>;
  agentName?: string;
  beforeLLMCall?: (
    ctx: LLMCallContext
  ) => void | BeforeLLMCallResult | Promise<void | BeforeLLMCallResult>;
  bgToolNames: Set<string>;
  config: ObskuConfig;
  contextWindowConfig?: ContextWindowConfig;
  def: AgentDef;
  emit: EmitFn;
  factoryRegistry?: import("../../agent-factory/index.js").AgentFactoryRegistry;
  handoffTargets?: Array<HandoffTarget>;
  messages: Array<Message>;
  onEntityExtract?: OnEntityExtractFn;
  onStepFinish?: (ctx: StepContext) => void | Promise<void>;
  onToolResult?: (ctx: ToolResultContext) => void | Promise<void>;
  outputGuardrails?: Array<GuardrailFn>;
  provider: LLMProvider;
  resolvedTools: Map<string, import("../setup.js").ResolvedTool>;
  resolvedTruncation?: ResolvedTruncation;
  responseFormat?: ResponseFormat;
  sessionId?: string;
  stopWhen?: (ctx: StepContext) => boolean;
  taskManager: TaskManager | undefined;
  telemetryConfig?: TelemetryConfig;
  toolDefs: Array<ToolDef>;
}

export type AgentIterationContext = {
  afterLLMCall?: AgentLoopParams["afterLLMCall"];
  agentName?: string;
  beforeLLMCall?: AgentLoopParams["beforeLLMCall"];
  bgToolNames: Set<string>;
  config: ObskuConfig;
  contextWindowConfig?: ContextWindowConfig;
  contextWindowManager?: ContextWindowManager;
  emit: EmitFn;
  handoffTargets?: Array<HandoffTarget>;
  lastNotificationCheck: number;
  lastText: string;
  messages: Array<Message>;
  onEntityExtract?: OnEntityExtractFn;
  onStepFinish?: AgentLoopParams["onStepFinish"];
  onToolResult?: AgentLoopParams["onToolResult"];
  outputGuardrails?: Array<GuardrailFn>;
  params: AgentLoopParams;
  provider: LLMProvider;
  resolvedTools: Map<string, import("../setup.js").ResolvedTool>;
  responseFormat?: ResponseFormat;
  sessionId?: string;
  stopWhen?: AgentLoopParams["stopWhen"];
  strategy: LLMCallStrategy;
  taskManager: TaskManager | undefined;
  telemetryConfig?: TelemetryConfig;
  toolDefs: Array<ToolDef>;
  usage: AgentUsage;
};

export type BeforeLLMCallState = {
  messages: Array<Message>;
  toolDefs: Array<ToolDef>;
};

export function updateOwnedCollections(
  ctx: AgentIterationContext,
  collections: Partial<BeforeLLMCallState>
): void {
  if (collections.messages) {
    ctx.messages = collections.messages;
    ctx.params.messages = collections.messages;
  }
  if (collections.toolDefs) {
    ctx.toolDefs = collections.toolDefs;
    ctx.params.toolDefs = collections.toolDefs;
  }
}

export function registerDynamicPlugin(
  ctx: AgentIterationContext,
  name: string,
  plugin: InternalPlugin,
  toolDef: ToolDef
): void {
  ctx.resolvedTools.set(name, { middleware: [], plugin });
  ctx.toolDefs.push(toolDef);
}
