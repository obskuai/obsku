import { Effect, Option } from "effect";
import type { AgentFactoryRegistry } from "../../agent-factory/index";
import type { TaskManager } from "../../background/index";
import type { CheckpointBackend } from "../../checkpoint/index";
import type { HandoffTarget } from "../../handoff/types";

import { ConfigService } from "../../services/config";
import { EventBus } from "../../services/event-bus";
import { debugLog } from "../../telemetry/log";
import type {
  AgentDef,
  AgentEvent,
  ConversationMessage,
  LLMProvider,
  ResponseFormat,
  ToolDef,
} from "../../types/index";
import { runAgentLoopBase } from "../agent-loop/index";
import type { AgentLoopContext, ExecutionContext, PersistenceContext } from "../agent-types";
import { persistResults } from "../persistence";
import { nonStreamingStrategy } from "../react-loop";
import { streamingStrategy } from "../stream-loop";
import { resolveTruncation } from "../truncation-resolve";
import { prepareExecutionContext } from "./execution";
import { loadSessionState } from "./session";
import { buildMessages, resolvePrompt } from "./startup";

export interface RunProgramParams {
  bgToolNames: Set<string>;
  checkpointStore: CheckpointBackend | undefined;
  def: AgentDef;
  externalMessages?: Array<ConversationMessage>;
  factoryRegistry?: AgentFactoryRegistry;
  handoffTargets: Array<HandoffTarget>;
  input: string;
  provider: LLMProvider;
  resolvedTools: Map<string, import("../setup.js").ResolvedTool>;
  responseFormat?: ResponseFormat;
  sessionId: string | undefined;
  taskManager: TaskManager | undefined;
  toolDefs: Array<ToolDef>;
}

function setupEventBus() {
  return Effect.gen(function* () {
    const config = yield* ConfigService;
    const eventBusOption = yield* Effect.serviceOption(EventBus);

    const emit = (event: AgentEvent) =>
      Option.isSome(eventBusOption)
        ? eventBusOption.value.publish(event).pipe(
            Effect.catchAll((error) => {
              debugLog(`Event bus publish failed for ${event.type}: ${String(error)}`);
              return Effect.succeed(false);
            })
          )
        : Effect.succeed(false);

    return { config, emit };
  });
}

function emitAgentStart(emit: (event: AgentEvent) => Effect.Effect<boolean>) {
  return emit({
    from: "Idle",
    timestamp: Date.now(),
    to: "Executing",
    type: "agent.transition",
  });
}

function executeAndPersist(
  strategy: typeof streamingStrategy | typeof nonStreamingStrategy,
  params: AgentLoopContext & PersistenceContext
) {
  return Effect.gen(function* () {
    const { outputGuardrails, ...rest } = params;
    const result = yield* runAgentLoopBase(strategy, {
      ...rest,
      outputGuardrails: outputGuardrails?.output,
    });

    yield* persistResults(params);

    return result;
  });
}

export function createProgram(params: RunProgramParams): Effect.Effect<string, unknown, ConfigService> {
  const { checkpointStore, def, input, provider, sessionId } = params;
  return Effect.gen(function* () {
    const { config, emit } = yield* setupEventBus();
    yield* emit({
      input,
      sessionId: sessionId ?? undefined,
      timestamp: Date.now(),
      type: "session.start",
    });
    yield* emitAgentStart(emit);
    const { history, memoryConfig, memoryInjection } = yield* loadSessionState(
      checkpointStore,
      sessionId,
      def,
      input,
      emit,
      params.externalMessages
    );
    const resolvedPrompt = yield* resolvePrompt(def.prompt, input, history, sessionId);
    const { effectivePrompt, messages } = yield* buildMessages(
      resolvedPrompt,
      input,
      history,
      memoryInjection,
      def.contextWindow,
      provider,
      emit,
      def.guardrails
    );
    const executionContext: ExecutionContext = prepareExecutionContext({
      config,
      effectivePrompt,
      emit,
      history,
      memoryConfig,
      messages,
      params,
      resolvedTruncation: resolveTruncation(def.truncation, provider.contextWindowSize),
    });
    const strategy = def.streaming ? streamingStrategy : nonStreamingStrategy;
    return yield* executeAndPersist(strategy, executionContext).pipe(
      Effect.tapError(() =>
        emit({
          sessionId: sessionId ?? undefined,
          status: "failed",
          timestamp: Date.now(),
          type: "session.end",
        })
      )
    );
  });
}
