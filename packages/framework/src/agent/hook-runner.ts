import { Effect, Option } from "effect";
import { debugLog } from "../telemetry/log";
import type {
  BeforeLLMCallResult,
  LLMCallContext,
  LLMResponse,
  Message,
  StepContext,
  ToolDef,
  ToolResultContext,
  ToolUseContent,
} from "../types";
import type { AgentIterationContext, AgentLoopParams } from "./agent-loop/index";
import type { EmitFn } from "./tool-executor";

export function runHook<A extends unknown[], R>(
  fn: (...args: A) => R | Promise<R>,
  ...args: A
): Effect.Effect<R, unknown> {
  return Effect.try({
    catch: (error) => new Error(String(error), { cause: error }),
    try: () => fn(...args),
  }).pipe(
    Effect.flatMap((result) => {
      // oxlint-disable-next-line @nkzw/no-instanceof -- intentional: detect Promise-like returns from sync hooks
      if (result instanceof Promise) {
        return Effect.tryPromise({
          catch: (error) => new Error(String(error), { cause: error }),
          try: () => result as Promise<R>,
        });
      }
      return Effect.succeed(result as R);
    })
  );
}

export function runHookSafe<T>(
  hookEffect: Effect.Effect<T, unknown>,
  hookName: string,
  emit: EmitFn
): Effect.Effect<Option.Option<T>> {
  return hookEffect.pipe(
    Effect.map(Option.some),
    Effect.catchAll((hookError) => {
      debugLog(`Hook ${hookName} failed: ${String(hookError)}`);
      return emit({
        error: String(hookError),
        hookName,
        timestamp: Date.now(),
        type: "hook.error",
      }).pipe(
        Effect.map(() => Option.none<T>()),
        Effect.catchAll((emitError) => {
          const msg = `hook.error emit failed: emit=${emitError}, original=${hookError}`;
          debugLog(msg);
          return Effect.succeed(Option.none<T>());
        })
      );
    })
  );
}

// Helper to run a simple hook (no return value processing)
function runSimpleHook<A extends unknown[]>(
  fn: ((...args: A) => void | Promise<void>) | undefined,
  hookName: string,
  args: A,
  emit: EmitFn
) {
  if (!fn) return Effect.succeed(undefined);
  return runHookSafe(runHook(fn, ...args), hookName, emit).pipe(Effect.map(() => undefined));
}

export function runBeforeLLMCallHook(
  beforeLLMCall: AgentLoopParams["beforeLLMCall"],
  llmCallCtx: LLMCallContext,
  messages: Array<Message>,
  toolDefs: Array<ToolDef>,
  emit: EmitFn
) {
  return Effect.gen(function* () {
    if (!beforeLLMCall) {
      return { messages, toolDefs };
    }

    const hookResultOpt = yield* runHookSafe(
      runHook(beforeLLMCall, llmCallCtx) as Effect.Effect<BeforeLLMCallResult>,
      "beforeLLMCall",
      emit
    );

    // If hook returned a result, use it to override messages/tools
    let nextMessages = messages;
    let nextToolDefs = toolDefs;
    if (Option.isSome(hookResultOpt)) {
      const hookResult = hookResultOpt.value;
      if (hookResult && typeof hookResult === "object") {
        if (Array.isArray(hookResult.messages)) {
          nextMessages = hookResult.messages;
        }
        if (Array.isArray(hookResult.tools)) {
          // Security: only allow tools from original toolDefs list
          const allowedToolNames = new Set(toolDefs.map((t: ToolDef) => t.name));
          const filteredTools = hookResult.tools.filter((t: ToolDef) =>
            allowedToolNames.has(t.name)
          );
          nextToolDefs = filteredTools;
        }
      }
    }
    return { messages: nextMessages, toolDefs: nextToolDefs };
    // intentional: user callback errors must not crash agent loop
  });
}

export function runAfterLLMCallHook(
  afterLLMCall: AgentLoopParams["afterLLMCall"],
  llmCallCtx: LLMCallContext,
  response: LLMResponse,
  emit: EmitFn
) {
  return runSimpleHook(afterLLMCall, "afterLLMCall", [{ ...llmCallCtx, response }], emit);
}

export function runEntityExtractHook(
  onEntityExtract: AgentLoopParams["onEntityExtract"],
  response: LLMResponse,
  emit: EmitFn
) {
  return runSimpleHook(onEntityExtract, "onEntityExtract", [response], emit);
}

export function runToolResultHook(
  onToolResult: AgentLoopParams["onToolResult"],
  toolCalls: Array<ToolUseContent>,
  syncResults: Array<{ isError?: boolean; result: string; toolName: string; toolUseId: string }>,
  emit: EmitFn,
  iteration: number
) {
  return Effect.gen(function* () {
    if (!onToolResult) {
      return;
    }

    const toolInputMap = new Map(
      toolCalls.map((tc) => [tc.toolUseId, tc.input as Record<string, unknown>])
    );
    for (const sr of syncResults) {
      const toolCtx: ToolResultContext = {
        input: toolInputMap.get(sr.toolUseId) ?? {},
        isError: sr.isError,
        iteration,
        result: sr.result,
        toolName: sr.toolName,
      };
      yield* runSimpleHook(onToolResult, "onToolResult", [toolCtx], emit);
      // intentional: user callback errors must not crash agent loop
    }
  });
}

export function runStepHooks(ctx: AgentIterationContext, stepCtx: StepContext) {
  return Effect.gen(function* () {
    if (ctx.onStepFinish) {
      yield* runSimpleHook(ctx.onStepFinish, "onStepFinish", [stepCtx], ctx.emit);
      // intentional: user callback errors must not crash agent loop
    }

    if (!ctx.stopWhen) {
      return false;
    }

    const stopWhenResult = yield* runHookSafe(
      Effect.sync(() => ctx.stopWhen!(stepCtx)),
      "stopWhen",
      ctx.emit
    );
    // intentional: user callback errors must not crash agent loop
    return Option.match(stopWhenResult, { onNone: () => false, onSome: (v) => v });
  });
}
