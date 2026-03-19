import type { AgentEvent, LLMResponse, MemoryConfig, Message } from "../../types/index";
import type { ExecutionContext } from "../agent-types";
import { buildMemoryHookContext, executeEntityExtract } from "../memory-integration";
import type { RunProgramParams } from "./index";

export type PrepareExecutionContextArgs = {
  config: ExecutionContext["config"];
  effectivePrompt: string;
  emit: (event: AgentEvent) => import("effect").Effect.Effect<boolean>;
  history: Array<Message>;
  memoryConfig: MemoryConfig | undefined;
  messages: Array<Message>;
  params: RunProgramParams;
  resolvedTruncation: ExecutionContext["resolvedTruncation"];
};

function buildExecutionContext({
  config,
  effectivePrompt,
  emit,
  history,
  memoryConfig,
  messages,
  onEntityExtract,
  params,
  resolvedTruncation,
}: PrepareExecutionContextArgs & {
  onEntityExtract: ((response: LLMResponse) => Promise<void>) | undefined;
}): ExecutionContext {
  return {
    afterLLMCall: params.def.afterLLMCall,
    agentName: params.def.name,
    beforeLLMCall: params.def.beforeLLMCall,
    bgToolNames: params.bgToolNames,
    checkpointStore: params.checkpointStore,
    config,
    contextWindowConfig: params.def.contextWindow,
    def: params.def,
    effectivePrompt,
    emit,
    factoryRegistry: params.factoryRegistry,
    handoffTargets: params.handoffTargets,
    history,
    input: params.input,
    memoryConfig,
    messages,
    onEntityExtract,
    onStepFinish: params.def.onStepFinish,
    onToolResult: params.def.onToolResult,
    outputGuardrails: params.def.guardrails,
    provider: params.provider,
    resolvedTools: params.resolvedTools,
    resolvedTruncation,
    responseFormat: params.responseFormat,
    sessionId: params.sessionId,
    stopWhen: params.def.stopWhen,
    taskManager: params.taskManager,
    telemetryConfig: params.def.telemetry,
    toolDefs: params.toolDefs,
  };
}

function createEntityExtractHandler(
  memoryConfig: MemoryConfig | undefined,
  sessionId: string | undefined,
  params: RunProgramParams,
  getMessages: () => Array<Message>
): ((response: LLMResponse) => Promise<void>) | undefined {
  return memoryConfig?.enabled && memoryConfig.store && sessionId
    ? async (response: LLMResponse) => {
        const memoryContext = buildMemoryHookContext(
          sessionId,
          params.def.name,
          getMessages(),
          memoryConfig,
          params.input
        );
        await executeEntityExtract(memoryConfig, { ...memoryContext, response }, params.provider);
      }
    : undefined;
}

export function prepareExecutionContext(args: PrepareExecutionContextArgs): ExecutionContext {
  const executionContextRef: { current?: ExecutionContext } = {};
  const onEntityExtract = createEntityExtractHandler(
    args.memoryConfig,
    args.params.sessionId,
    args.params,
    () => executionContextRef.current?.messages ?? args.messages
  );

  const executionContext = buildExecutionContext({
    ...args,
    onEntityExtract,
  });
  executionContextRef.current = executionContext;

  return executionContext;
}
