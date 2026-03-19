import { Effect } from "effect";
import type { StoredMessage } from "../checkpoint/index";
import { toCheckpointPayloads } from "../checkpoint/message-serializer";
import { BlockType, MessageRole } from "../types/constants";
import type { AgentDef, Message } from "../types/index";
import { buildInitialMessages } from "./message-builder";
import { type CheckpointPersistenceArgs, emitMemorySaveAfter } from "./persistence-shared";

type TransientMemoryMessage = Message & { __obskuTransientMemoryInjection?: true };

const MEMORY_CONTEXT_HEADING = "## Memory Context\n";

function isPlainTextUserMessage(message: Message, expectedText?: string) {
  if (message.role !== MessageRole.USER || message.content.length !== 1) {
    return false;
  }

  const [block] = message.content;
  if (!block || block.type !== BlockType.TEXT) {
    return false;
  }

  return expectedText === undefined ? true : block.text === expectedText;
}

function getPlainTextUserMessage(message: Message): string | undefined {
  if (message.role !== MessageRole.USER || message.content.length !== 1) {
    return undefined;
  }

  const [block] = message.content;
  return block && block.type === BlockType.TEXT ? block.text : undefined;
}

function isTransientMemoryMessage(message: Message) {
  if ((message as TransientMemoryMessage).__obskuTransientMemoryInjection === true) {
    return true;
  }

  const text = getPlainTextUserMessage(message);
  return text !== undefined && text.startsWith(MEMORY_CONTEXT_HEADING);
}

function buildDurableMessageSlice(
  messages: Array<Message>,
  input: string,
  newMessagesStart: number
) {
  const newMessages = messages.slice(newMessagesStart);
  const durableMessages = newMessages.filter((message) => !isTransientMemoryMessage(message));

  if (durableMessages.length > 0 && isPlainTextUserMessage(durableMessages[0], input)) {
    return durableMessages.slice(1);
  }

  return durableMessages;
}

function ensureCheckpointSession(
  checkpointStore: CheckpointPersistenceArgs["checkpointStore"],
  sessionId: string,
  def: AgentDef
) {
  return Effect.gen(function* () {
    const existingSession = yield* Effect.promise(() => checkpointStore.getSession(sessionId));
    if (existingSession) {
      return existingSession;
    }

    return yield* Effect.promise(() =>
      checkpointStore.createSession("/tmp/agent-session", { title: `Agent: ${def.name}` })
    );
  });
}

function buildCheckpointMessages({
  history,
  input,
  messages,
  resolvedPrompt,
  sessionId,
}: Omit<CheckpointPersistenceArgs, "checkpointStore" | "def" | "emit">) {
  const newMessagesStart = buildInitialMessages(resolvedPrompt, input, history).length;
  const checkpointMessages = toCheckpointPayloads(
    buildDurableMessageSlice(messages, input, newMessagesStart),
    sessionId
  );

  return [
    {
      content: input,
      role: "user" as const,
      sessionId,
    },
    ...checkpointMessages,
  ];
}

function persistMessagesSequential(
  checkpointStore: CheckpointPersistenceArgs["checkpointStore"],
  sessionId: string,
  messages: Array<Omit<StoredMessage, "id" | "createdAt">>
) {
  return Effect.gen(function* () {
    for (const message of messages) {
      yield* Effect.promise(() => checkpointStore.addMessage(sessionId, message));
    }
  });
}

export function selectCheckpointPersistence(
  checkpointStore: CheckpointPersistenceArgs["checkpointStore"] | undefined,
  sessionId: string | undefined,
  args: Omit<CheckpointPersistenceArgs, "checkpointStore" | "sessionId">
): CheckpointPersistenceArgs | undefined {
  if (!checkpointStore || !sessionId) {
    return undefined;
  }

  return {
    ...args,
    checkpointStore,
    sessionId,
  };
}

export function persistCheckpointMessages(args: CheckpointPersistenceArgs) {
  return emitMemorySaveAfter(
    Effect.gen(function* () {
      const session = yield* ensureCheckpointSession(
        args.checkpointStore,
        args.sessionId,
        args.def
      );
      const checkpointMessages = buildCheckpointMessages({
        history: args.history,
        input: args.input,
        messages: args.messages,
        resolvedPrompt: args.resolvedPrompt,
        sessionId: session.id,
      });

      yield* persistMessagesSequential(args.checkpointStore, session.id, checkpointMessages);
      return session.id;
    }),
    args.emit,
    (sessionId) => ({
      messageCount: args.messages.length,
      sessionId,
    })
  );
}
