import { Effect } from "effect";
import type { CheckpointStore } from "../checkpoint/index";
import type { AgentDef, AgentEvent, LLMProvider, MemoryConfig, Message } from "../types/index";
import {
  persistCheckpointMessages,
  selectCheckpointPersistence,
} from "./persistence-checkpoint";
import { persistLegacyMessages, selectLegacyPersistence } from "./persistence-legacy";
import {
  persistMemoryHookResults,
  selectMemoryHookPersistence,
} from "./persistence-memory-hooks";
import { persistSelectedStorage, selectStoragePersistence } from "./persistence-mode-selection";

export function persistToCheckpointStore(
  checkpointStore: CheckpointStore | undefined,
  sessionId: string | undefined,
  messages: Array<Message>,
  def: AgentDef,
  resolvedPrompt: string,
  history: Array<Message>,
  input: string,
  emit: (event: AgentEvent) => Effect.Effect<boolean>
) {
  return Effect.gen(function* () {
    const args = selectCheckpointPersistence(checkpointStore, sessionId, {
      def,
      emit,
      history,
      input,
      messages,
      resolvedPrompt,
    });

    if (!args) {
      return;
    }

    yield* persistCheckpointMessages(args);
  });
}

export function persistToLegacyMemory(
  checkpointStore: CheckpointStore | undefined,
  sessionId: string | undefined,
  messages: Array<Message>,
  def: AgentDef,
  emit: (event: AgentEvent) => Effect.Effect<boolean>
) {
  return Effect.gen(function* () {
    const args = selectLegacyPersistence(checkpointStore, sessionId, {
      def,
      emit,
      messages,
    });

    if (!args) {
      return;
    }

    yield* persistLegacyMessages(args);
  });
}

export function persistMemoryHooks(
  sessionId: string | undefined,
  messages: Array<Message>,
  def: AgentDef,
  input: string,
  emit: (event: AgentEvent) => Effect.Effect<boolean>,
  memoryConfig: MemoryConfig | undefined,
  provider: LLMProvider
) {
  return Effect.gen(function* () {
    const args = selectMemoryHookPersistence(
      sessionId,
      {
        def,
        emit,
        input,
        messages,
        provider,
      },
      memoryConfig
    );

    if (!args) {
      return;
    }

    yield* persistMemoryHookResults(args);
  });
}

export function persistResults(ctx: {
  checkpointStore: CheckpointStore | undefined;
  def: AgentDef;
  effectivePrompt: string;
  emit: (event: AgentEvent) => Effect.Effect<boolean>;
  history: Array<Message>;
  input: string;
  memoryConfig: MemoryConfig | undefined;
  messages: Array<Message>;
  provider: LLMProvider;
  sessionId: string | undefined;
}) {
  return Effect.gen(function* () {
    if (!ctx.sessionId) return;

    yield* persistSelectedStorage(selectStoragePersistence(ctx));

    // Memory hooks run independently of the storage choice above.
    const memoryHookPersistence = selectMemoryHookPersistence(
      ctx.sessionId,
      {
        def: ctx.def,
        emit: ctx.emit,
        input: ctx.input,
        messages: ctx.messages,
        provider: ctx.provider,
      },
      ctx.memoryConfig
    );

    if (memoryHookPersistence) {
      yield* persistMemoryHookResults(memoryHookPersistence);
    }
  });
}
