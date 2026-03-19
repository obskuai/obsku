import { Effect } from "effect";
import type { CheckpointStore } from "../checkpoint/index";
import type { AgentDef, AgentEvent, LLMProvider, MemoryConfig, Message } from "../types/index";

export type PersistenceEmitter = (event: AgentEvent) => Effect.Effect<boolean>;

export type CheckpointPersistenceArgs = {
  checkpointStore: CheckpointStore;
  def: AgentDef;
  emit: PersistenceEmitter;
  history: Array<Message>;
  input: string;
  messages: Array<Message>;
  resolvedPrompt: string;
  sessionId: string;
};

export type LegacyPersistenceArgs = {
  def: AgentDef;
  emit: PersistenceEmitter;
  messages: Array<Message>;
  sessionId: string;
};

export type MemoryHookPersistenceArgs = {
  def: AgentDef;
  emit: PersistenceEmitter;
  input: string;
  memoryConfig: MemoryConfig;
  messages: Array<Message>;
  provider: LLMProvider;
  sessionId: string;
};

export function emitMemorySave(emit: PersistenceEmitter, sessionId: string, messageCount: number) {
  return emit({
    messageCount,
    sessionId,
    timestamp: Date.now(),
    type: "memory.save",
  });
}

export function emitMemorySaveAfter<T>(
  persist: Effect.Effect<T>,
  emit: PersistenceEmitter,
  resolveEvent: (result: T) => { messageCount: number; sessionId: string }
) {
  return Effect.gen(function* () {
    const result = yield* persist;
    const event = resolveEvent(result);
    yield* emitMemorySave(emit, event.sessionId, event.messageCount);
    return result;
  });
}
