import { Effect } from "effect";
import { ContextWindowManager } from "../context-window";
import { resolveContextWindow } from "../context-window-resolve";
import type { LLMCallStrategy } from "../llm-phase";
import type { AgentIterationContext, AgentLoopParams } from "./state";

export function createAgentIterationContext(strategy: LLMCallStrategy, params: AgentLoopParams) {
  const ctx: AgentIterationContext = {
    afterLLMCall: params.afterLLMCall,
    agentName: params.agentName,
    beforeLLMCall: params.beforeLLMCall,
    bgToolNames: params.bgToolNames,
    config: params.config,
    contextWindowConfig: params.contextWindowConfig,
    emit: params.emit,
    handoffTargets: params.handoffTargets,
    lastNotificationCheck: 0,
    lastText: "",
    messages: params.messages,
    onEntityExtract: params.onEntityExtract,
    onStepFinish: params.onStepFinish,
    onToolResult: params.onToolResult,
    outputGuardrails: params.outputGuardrails,
    params,
    provider: params.provider,
    resolvedTools: params.resolvedTools,
    responseFormat: params.responseFormat,
    sessionId: params.sessionId,
    stopWhen: params.stopWhen,
    strategy,
    taskManager: params.taskManager,
    telemetryConfig: params.telemetryConfig,
    toolDefs: params.toolDefs,
    usage: { llmCalls: 0, totalInputTokens: 0, totalOutputTokens: 0 },
  };

  return ctx;
}

export function initializeLoop(ctx: AgentIterationContext) {
  return Effect.sync(() => {
    const cwResolved = resolveContextWindow(
      ctx.contextWindowConfig,
      ctx.provider.contextWindowSize
    );
    ctx.contextWindowManager = cwResolved.active
      ? new ContextWindowManager(cwResolved.config)
      : undefined;
    ctx.lastNotificationCheck = Date.now();
    ctx.lastText = "";
    ctx.usage = { llmCalls: 0, totalInputTokens: 0, totalOutputTokens: 0 };
  });
}

export function finalizeLoop(ctx: AgentIterationContext) {
  return Effect.gen(function* () {
    if (ctx.taskManager) {
      ctx.taskManager.cleanup();
    }

    yield* ctx.emit({
      from: "Executing",
      timestamp: Date.now(),
      to: "Done",
      type: "agent.transition",
    });

    yield* ctx.emit({
      summary: ctx.lastText,
      timestamp: Date.now(),
      type: "agent.complete",
      usage: ctx.usage,
    });

    yield* ctx.emit({
      output: ctx.lastText,
      sessionId: ctx.sessionId ?? undefined,
      status: "complete",
      timestamp: Date.now(),
      turns: ctx.usage.llmCalls,
      type: "session.end",
    });

    return ctx.lastText;
  });
}
