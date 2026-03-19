import { Effect } from "effect";
import type { CheckpointBackend } from "../../checkpoint/index";
import type { StoredMessage } from "../../checkpoint/types";
import type { MemoryInjection, MemoryProvider } from "../../memory/types";
import { BlockType, MessageRole } from "../../types/constants";
import type {
  AgentDef,
  AgentEvent,
  ContentBlock,
  ConversationMessage,
  MemoryConfig,
  Message,
} from "../../types/index";
import { isMemoryConfig, isMemoryProvider } from "../guards";
import { buildMemoryHookContext, executeMemoryLoad } from "../memory-integration";

type AgentEventEmitter = (event: AgentEvent) => Effect.Effect<boolean>;

type PersistedHistoryLoadArgs = {
  checkpointStore: CheckpointBackend | undefined;
  def: AgentDef;
  emit: AgentEventEmitter;
  sessionId: string | undefined;
};

type SessionMemoryInjectionArgs = {
  def: AgentDef;
  emit: AgentEventEmitter;
  history: Array<Message>;
  input: string;
  sessionId: string | undefined;
};

export type SessionState = {
  history: Array<Message>;
  memoryConfig: MemoryConfig | undefined;
  memoryInjection: MemoryInjection | null;
};

function convertCheckpointMessages(checkpointMessages: Array<StoredMessage>): Array<Message> {
  return checkpointMessages.flatMap((message): Array<Message> => {
    if (message.role === MessageRole.ASSISTANT) {
      const content: Array<ContentBlock> = [];
      if (message.content) {
        content.push({ text: message.content, type: BlockType.TEXT });
      }
      if (message.toolCalls) {
        for (const toolCall of message.toolCalls) {
          content.push({
            input: toolCall.input,
            name: toolCall.name,
            toolUseId: toolCall.toolUseId,
            type: BlockType.TOOL_USE,
          });
        }
      }
      return content.length > 0 ? [{ content, role: MessageRole.ASSISTANT }] : [];
    }

    if (
      message.role === MessageRole.TOOL &&
      message.toolResults &&
      message.toolResults.length > 0
    ) {
      return [
        {
          content: message.toolResults.map((toolResult) => ({
            content: toolResult.content,
            toolUseId: toolResult.toolUseId,
            type: BlockType.TOOL_RESULT,
          })),
          role: MessageRole.USER,
        },
      ];
    }

    if (message.role === MessageRole.USER && message.content) {
      return [
        { content: [{ text: message.content, type: BlockType.TEXT }], role: MessageRole.USER },
      ];
    }

    if (message.role === MessageRole.SYSTEM && message.content) {
      return [
        { content: [{ text: message.content, type: BlockType.TEXT }], role: MessageRole.SYSTEM },
      ];
    }

    return [];
  });
}

function emitMemoryLoad(emit: AgentEventEmitter, sessionId: string, messageCount: number) {
  return emit({
    messageCount,
    sessionId,
    timestamp: Date.now(),
    type: "memory.load",
  });
}

function loadPersistedHistory({
  checkpointStore,
  def,
  emit,
  sessionId,
}: PersistedHistoryLoadArgs): Effect.Effect<Array<Message>, unknown> {
  return Effect.gen(function* () {
    if (!sessionId) {
      return [] as Array<Message>;
    }

    if (checkpointStore) {
      return yield* loadCheckpointHistory(checkpointStore, sessionId, emit);
    }

    if (def.memory && isMemoryProvider(def.memory)) {
      return yield* loadLegacyHistory(def.memory, sessionId, emit);
    }

    return [] as Array<Message>;
  });
}

function loadCheckpointHistory(
  checkpointStore: CheckpointBackend,
  sessionId: string,
  emit: AgentEventEmitter
): Effect.Effect<Array<Message>, unknown> {
  return Effect.gen(function* () {
    const session = yield* Effect.promise(() => checkpointStore.getSession(sessionId));
    if (!session) {
      return [] as Array<Message>;
    }

    const checkpointMessages = yield* Effect.promise(() => checkpointStore.getMessages(sessionId));
    const history = convertCheckpointMessages(checkpointMessages);
    yield* emitMemoryLoad(emit, sessionId, history.length);
    return history;
  });
}

function loadLegacyHistory(
  memory: MemoryProvider,
  sessionId: string,
  emit: AgentEventEmitter
): Effect.Effect<Array<Message>, unknown> {
  return Effect.promise<Array<Message>>(() => memory.load(sessionId)).pipe(
    Effect.flatMap((history) =>
      emitMemoryLoad(emit, sessionId, history.length).pipe(Effect.as(history))
    )
  );
}

function mergeExternalMessages(
  history: Array<Message>,
  externalMessages: Array<ConversationMessage> | undefined
): Array<Message> {
  if (!externalMessages || externalMessages.length === 0) {
    return history;
  }

  const converted = externalMessages.map(
    (message): Message => ({
      content: [{ text: message.content, type: BlockType.TEXT }],
      role: message.role === MessageRole.ASSISTANT ? MessageRole.ASSISTANT : MessageRole.USER,
    })
  );

  return [...converted, ...history];
}

function injectMemoryContext({ def, emit, history, input, sessionId }: SessionMemoryInjectionArgs) {
  return Effect.gen(function* () {
    const memoryConfig = isMemoryConfig(def.memory) ? (def.memory as MemoryConfig) : undefined;
    if (!memoryConfig?.enabled || !memoryConfig.store || !sessionId) {
      return { memoryConfig, memoryInjection: null as MemoryInjection | null };
    }

    const memoryContext = buildMemoryHookContext(sessionId, def.name, history, memoryConfig, input);
    const memoryInjection = yield* Effect.promise(() =>
      executeMemoryLoad(memoryConfig, memoryContext)
    );

    if (memoryInjection) {
      yield* emitMemoryLoad(emit, sessionId, memoryInjection.entities?.length ?? 0);
    }

    return { memoryConfig, memoryInjection };
  });
}

export function loadSessionState(
  checkpointStore: CheckpointBackend | undefined,
  sessionId: string | undefined,
  def: AgentDef,
  input: string,
  emit: AgentEventEmitter,
  externalMessages: Array<ConversationMessage> | undefined
): Effect.Effect<SessionState, unknown> {
  return Effect.gen(function* () {
    const persistedHistory = (yield* loadPersistedHistory({
      checkpointStore,
      def,
      emit,
      sessionId,
    })) as Array<Message>;
    const history = mergeExternalMessages(persistedHistory, externalMessages);
    const { memoryConfig, memoryInjection } = yield* injectMemoryContext({
      def,
      emit,
      history,
      input,
      sessionId,
    });

    return { history, memoryConfig, memoryInjection } satisfies SessionState;
  });
}
