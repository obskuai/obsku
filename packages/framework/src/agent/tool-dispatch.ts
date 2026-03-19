import { Effect } from "effect";
import type { TaskManager } from "../background";
import { executeHandoff, getHandoffTargetByName } from "../handoff/handoff";
import type { HandoffTarget } from "../handoff/types";
import type { ObskuConfig } from "../services/config";
import type { TelemetryConfig } from "../telemetry/types";
import type { AgentDef, LLMResponse, Message, StepContext, ToolUseContent } from "../types";
import { toToolResultEnvelope } from "../utils";
import type { AgentIterationContext } from "./agent-loop/index";
import type { ToolResultWithMeta } from "./directive-processor";
import { applyToolResults } from "./directive-processor";
import { runStepHooks, runToolResultHook } from "./hook-runner";
import { makeErrorEnvelope } from "./tool-execution-shared";
import type { EmitFn, ToolExecutionResult } from "./tool-executor";
import { executeSyncTools, startBackgroundTasks } from "./tool-executor";

export interface DispatchContext {
  agentDef: AgentDef;
  agentName: string | undefined;
  bgCalls: Array<ToolUseContent>;
  config: ObskuConfig;
  emit: EmitFn;
  handoffCalls: Array<ToolUseContent>;
  handoffTargets: HandoffTarget[] | undefined;
  iteration: number;
  messages: Array<Message>;
  provider: import("../types").LLMProvider;
  resolvedTools: Map<string, import("./setup.js").ResolvedTool>;
  sessionId: string | undefined;
  syncCalls: Array<ToolUseContent>;
  taskManager: TaskManager | undefined;
  telemetryConfig: TelemetryConfig | undefined;
}

export function dispatchTools(ctx: DispatchContext): Effect.Effect<
  {
    allResults: Array<ToolExecutionResult>;
    handoffFinalResult: string | undefined;
    syncResults: Array<ToolExecutionResult>;
  },
  unknown
> {
  return Effect.gen(function* () {
    const syncResults = yield* executeSyncTools(
      ctx.syncCalls,
      ctx.resolvedTools,
      ctx.agentDef,
      ctx.config,
      ctx.emit,
      ctx.telemetryConfig,
      {
        agentName: ctx.agentName,
        iteration: ctx.iteration,
        sessionId: ctx.sessionId,
      }
    );

    const bgResults =
      ctx.taskManager && ctx.bgCalls.length > 0
        ? yield* startBackgroundTasks(ctx.bgCalls, ctx.resolvedTools, ctx.taskManager, ctx.emit)
        : [];

    let handoffFinalResult: string | undefined;
    const handoffResults: Array<{
      isError: false;
      result: string;
      toolName: string;
      toolUseId: string;
    }> = [];
    for (const hc of ctx.handoffCalls) {
      const target = ctx.handoffTargets && getHandoffTargetByName(hc.name, ctx.handoffTargets);
      const agentName = ctx.agentName;
      if (target && agentName) {
        const handoffResult = yield* Effect.promise(() =>
          executeHandoff(
            target,
            { messages: ctx.messages, provider: ctx.provider, sessionId: ctx.sessionId },
            ctx.emit,
            agentName
          )
        );
        handoffResults.push({
          isError: false,
          result: JSON.stringify(handoffResult),
          toolName: hc.name,
          toolUseId: hc.toolUseId,
        });
        handoffFinalResult = handoffResult.result;
      } else {
        handoffResults.push({
          isError: false,
          result: makeErrorEnvelope(`Handoff target not found: ${hc.name}`),
          toolName: hc.name,
          toolUseId: hc.toolUseId,
        });
      }
    }

    const allResults = [...syncResults, ...bgResults, ...handoffResults];

    return { allResults, handoffFinalResult, syncResults };
  });
}

export function buildStepContext(
  iteration: number,
  messages: Array<Message>,
  response: LLMResponse,
  allResults: Array<ToolResultWithMeta>,
  toolCalls: Array<ToolUseContent>
): StepContext {
  const toolCallMap = new Map(toolCalls.map((tc) => [tc.toolUseId, tc.name]));
  return {
    iteration: iteration,
    lastResponse: response,
    messages,
    toolResults: allResults.map((result) => ({
      result: toToolResultEnvelope(result),
      toolName: result.toolName ?? toolCallMap.get(result.toolUseId) ?? "",
    })),
  };
}

export function runToolsPhase(
  ctx: AgentIterationContext,
  iteration: number,
  response: LLMResponse,
  toolCalls: Array<ToolUseContent>,
  syncCalls: Array<ToolUseContent>,
  bgCalls: Array<ToolUseContent>,
  handoffCalls: Array<ToolUseContent>
): Effect.Effect<{ handoffFinalResult?: string; shouldBreak: boolean }, unknown> {
  return Effect.gen(function* () {
    const { allResults, handoffFinalResult, syncResults } = yield* dispatchTools({
      agentDef: ctx.params.def,
      agentName: ctx.agentName,
      bgCalls,
      config: ctx.config,
      emit: ctx.emit,
      handoffCalls,
      handoffTargets: ctx.handoffTargets,
      iteration: iteration,
      messages: ctx.messages,
      provider: ctx.provider,
      resolvedTools: ctx.resolvedTools,
      sessionId: ctx.sessionId,
      syncCalls,
      taskManager: ctx.taskManager,
      telemetryConfig: ctx.telemetryConfig,
    });

    if (handoffFinalResult !== undefined) {
      yield* ctx.emit({
        from: "Executing",
        timestamp: Date.now(),
        to: "Done",
        type: "agent.transition",
      });
      yield* ctx.emit({
        summary: handoffFinalResult,
        timestamp: Date.now(),
        type: "agent.complete",
        usage: ctx.usage,
      });
      return { handoffFinalResult, shouldBreak: true };
    }

    yield* applyToolResults(allResults, ctx.params.resolvedTruncation, ctx.messages, ctx.emit);
    yield* runToolResultHook(
      ctx.onToolResult,
      toolCalls,
      syncResults as Array<ToolExecutionResult>,
      ctx.emit,
      iteration
    );
    const stepCtx = buildStepContext(iteration, ctx.messages, response, allResults, toolCalls);
    const shouldBreak = yield* runStepHooks(ctx, stepCtx);
    return { shouldBreak };
  });
}
