import { Effect } from "effect";
import type { LLMCallStrategy } from "../llm-phase";
import { runSingleIteration } from "./iteration";
import { createAgentIterationContext, finalizeLoop, initializeLoop } from "./lifecycle";
import {
  type AgentIterationContext,
  type AgentLoopParams,
  type OnEntityExtractFn,
  registerDynamicPlugin,
} from "./state";

export type { LLMCallStrategy };
export type { AgentIterationContext, AgentLoopParams, OnEntityExtractFn };
export { registerDynamicPlugin };

export function runAgentLoopBase(strategy: LLMCallStrategy, params: AgentLoopParams) {
  return Effect.gen(function* () {
    const ctx = createAgentIterationContext(strategy, params);

    if (params.factoryRegistry) {
      params.factoryRegistry.setContext(ctx);
    }

    yield* initializeLoop(ctx);

    for (let i = 0; i < ctx.config.maxIterations; i++) {
      const result = yield* runSingleIteration(ctx, i);
      if (result.handoffFinalResult !== undefined) {
        return result.handoffFinalResult;
      }
      if (result.shouldBreak) {
        break;
      }
    }

    return yield* finalizeLoop(ctx);
  });
}
