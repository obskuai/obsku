import { Effect } from "effect";
import { isHandoffToolName } from "../../handoff/handoff";
import { BlockType, MessageRole } from "../../types/constants";
import type {
  LLMCallContext,
  LLMResponse,
  Message,
  ToolDef,
  ToolUseContent,
} from "../../types/index";
import { applyContextWindow, emitContextWindowEvents } from "../context-window";
import { handleTextBlocksAndGuardrails } from "../directive-processor";
import { runAfterLLMCallHook, runBeforeLLMCallHook, runEntityExtractHook } from "../hook-runner";
import { callLLMWithEvents } from "../llm-phase";
import { buildBackgroundNotifications } from "../message-builder";
import { runToolsPhase } from "../tool-dispatch";
import {
  type AgentIterationContext,
  type BeforeLLMCallState,
  updateOwnedCollections,
} from "./state";

function prepareToolCalls(
  response: LLMResponse,
  toolDefs: Array<ToolDef>,
  bgToolNames: Set<string>,
  messages: Array<Message>
) {
  const toolCalls =
    toolDefs.length > 0
      ? response.content.filter((c): c is ToolUseContent => c.type === BlockType.TOOL_USE)
      : [];

  const sanitizedContent = response.content.map((block) =>
    block.type === BlockType.TEXT ? { ...block, text: block.text.trimEnd() } : block
  );
  messages.push({ content: sanitizedContent, role: MessageRole.ASSISTANT });

  const bgCalls = toolCalls.filter((tc) => bgToolNames.has(tc.name));
  const handoffCalls = toolCalls.filter((tc) => isHandoffToolName(tc.name));
  const syncCalls = toolCalls.filter(
    (tc) => !bgToolNames.has(tc.name) && !isHandoffToolName(tc.name)
  );

  return { bgCalls, handoffCalls, syncCalls, toolCalls };
}

function manageContextWindow(
  messages: Array<Message>,
  ctx: Pick<
    AgentIterationContext,
    "contextWindowConfig" | "contextWindowManager" | "emit" | "provider"
  >
) {
  return Effect.gen(function* () {
    if (!ctx.contextWindowManager) {
      return messages;
    }

    const compactionProvider = ctx.contextWindowConfig?.compactionProvider ?? ctx.provider;
    const cwResult = yield* applyContextWindow(
      messages,
      ctx.contextWindowManager,
      compactionProvider,
      ctx.contextWindowConfig?.compactionStrategy
    );
    yield* emitContextWindowEvents(cwResult, ctx.emit);
    return cwResult.messages;
  });
}

export function applyBackgroundNotifications(ctx: AgentIterationContext): Effect.Effect<void> {
  return Effect.sync(() => {
    if (!ctx.taskManager) {
      return;
    }

    const { messages: notifMsgs, newCheckTime } = buildBackgroundNotifications(
      ctx.taskManager,
      ctx.lastNotificationCheck
    );
    for (const msg of notifMsgs) {
      ctx.messages.push(msg);
    }
    ctx.lastNotificationCheck = newCheckTime;
  });
}

function updateUsage(ctx: AgentIterationContext, response: LLMResponse) {
  if (ctx.contextWindowManager && response.usage) {
    ctx.contextWindowManager.updateUsage(response.usage);
  }

  if (response.usage) {
    ctx.usage.totalInputTokens += response.usage.inputTokens;
    ctx.usage.totalOutputTokens += response.usage.outputTokens;
    ctx.usage.llmCalls++;
  }
}

export function runLLMPhase(
  ctx: AgentIterationContext,
  iteration: number
): Effect.Effect<
  {
    bgCalls: ToolUseContent[];
    handoffCalls: ToolUseContent[];
    response: LLMResponse;
    syncCalls: ToolUseContent[];
    toolCalls: ToolUseContent[];
  },
  unknown
> {
  return Effect.gen(function* () {
    const llmCallState: BeforeLLMCallState = {
      messages: ctx.messages,
      toolDefs: ctx.toolDefs,
    };
    const llmCallCtx: LLMCallContext = {
      iteration,
      messages: llmCallState.messages,
      tools: llmCallState.toolDefs,
    };

    const nextLLMState = yield* runBeforeLLMCallHook(
      ctx.beforeLLMCall,
      llmCallCtx,
      llmCallState.messages,
      llmCallState.toolDefs,
      ctx.emit
    );
    updateOwnedCollections(ctx, nextLLMState);

    const llmMessages = ctx.messages.slice();
    const llmToolDefs = ctx.toolDefs.slice();
    llmCallCtx.messages = llmMessages;
    llmCallCtx.tools = llmToolDefs;

    const response = yield* callLLMWithEvents(
      ctx.strategy,
      ctx.provider,
      llmMessages,
      llmToolDefs,
      ctx.telemetryConfig,
      ctx.emit,
      ctx.responseFormat,
      iteration
    );

    updateUsage(ctx, response);
    yield* runAfterLLMCallHook(ctx.afterLLMCall, llmCallCtx, response, ctx.emit);
    yield* runEntityExtractHook(ctx.onEntityExtract, response, ctx.emit);
    ctx.lastText = yield* handleTextBlocksAndGuardrails(
      response,
      ctx.outputGuardrails,
      ctx.messages,
      ctx.emit,
      ctx.lastText
    );

    return { response, ...prepareToolCalls(response, ctx.toolDefs, ctx.bgToolNames, ctx.messages) };
  });
}

export function runSingleIteration(
  ctx: AgentIterationContext,
  iteration: number
): Effect.Effect<{ handoffFinalResult?: string; shouldBreak: boolean }, unknown> {
  return Effect.gen(function* () {
    yield* applyBackgroundNotifications(ctx);
    updateOwnedCollections(ctx, {
      messages: yield* manageContextWindow(ctx.messages, ctx),
    });

    const { bgCalls, handoffCalls, response, syncCalls, toolCalls } = yield* runLLMPhase(
      ctx,
      iteration
    );

    if (toolCalls.length === 0) {
      return { shouldBreak: true };
    }

    return yield* runToolsPhase(
      ctx,
      iteration,
      response,
      toolCalls,
      syncCalls,
      bgCalls,
      handoffCalls
    );
  });
}
