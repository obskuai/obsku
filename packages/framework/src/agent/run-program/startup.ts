import { Effect } from "effect";
import { GuardrailError } from "../../guardrails/index";
import { runInputGuardrails } from "../../guardrails/runner";
import type { MemoryInjection } from "../../memory/types";
import { BlockType, MessageRole } from "../../types/constants";
import type {
  AgentDef,
  AgentEvent,
  ContextWindowConfig,
  LLMProvider,
  Message,
} from "../../types/index";
import {
  applyContextWindow,
  ContextWindowManager,
  emitContextWindowEvents,
} from "../context-window";
import { resolveContextWindow } from "../context-window-resolve";
import { buildInitialMessages } from "../message-builder";

type AgentEventEmitter = (event: AgentEvent) => Effect.Effect<boolean>;
type TransientMemoryMessage = Message & { __obskuTransientMemoryInjection?: true };

const MEMORY_CONTEXT_HEADING = "## Memory Context";

function buildTransientMemorySnapshot(context: string) {
  return `${MEMORY_CONTEXT_HEADING}\n${context}`;
}

function injectTransientMemorySnapshot(
  messages: Array<Message>,
  input: string,
  memoryInjection: MemoryInjection | null
): Array<Message> {
  if (!memoryInjection?.context) {
    return messages;
  }

  const snapshotMessage: TransientMemoryMessage = {
    __obskuTransientMemoryInjection: true,
    content: [
      { text: buildTransientMemorySnapshot(memoryInjection.context), type: BlockType.TEXT },
    ],
    role: MessageRole.USER,
  };
  const nextMessages = [...messages];

  for (let i = nextMessages.length - 1; i >= 0; i--) {
    const message = nextMessages[i];
    if (message.role !== MessageRole.USER) {
      continue;
    }

    const lastBlock = message.content.at(-1);
    if (!lastBlock || lastBlock.type !== BlockType.TEXT || lastBlock.text !== input) {
      continue;
    }

    const prefixContent = message.content.slice(0, -1);
    const replacement: Array<Message> = [];

    if (prefixContent.length > 0) {
      replacement.push({ content: prefixContent, role: MessageRole.USER });
    }

    replacement.push(snapshotMessage, {
      content: [{ text: input, type: BlockType.TEXT }],
      role: MessageRole.USER,
    });
    nextMessages.splice(i, 1, ...replacement);
    return nextMessages;
  }

  return [...nextMessages, snapshotMessage];
}

export function resolvePrompt(
  prompt: AgentDef["prompt"],
  input: string,
  history: Array<Message>,
  sessionId: string | undefined
) {
  return typeof prompt === "function"
    ? Effect.promise(() => Promise.resolve(prompt({ input, messages: history, sessionId })))
    : Effect.succeed(prompt);
}

export function buildMessages(
  resolvedPrompt: string,
  input: string,
  history: Array<Message>,
  memoryInjection: MemoryInjection | null,
  contextWindow: ContextWindowConfig | undefined,
  provider: LLMProvider,
  emit: AgentEventEmitter,
  inputGuardrails: AgentDef["guardrails"] | undefined
) {
  return Effect.gen(function* () {
    const effectivePrompt = resolvedPrompt;
    const initialMessages = buildInitialMessages(effectivePrompt, input, history);
    const requestMessages = injectTransientMemorySnapshot(initialMessages, input, memoryInjection);
    let messages = requestMessages;
    const contextWindowResolution = resolveContextWindow(contextWindow, provider.contextWindowSize);

    if (contextWindowResolution.active) {
      const contextWindowManager = new ContextWindowManager(contextWindowResolution.config);
      const compactionProvider = contextWindow?.compactionProvider ?? provider;
      const contextWindowResult = yield* applyContextWindow(
        messages,
        contextWindowManager,
        compactionProvider,
        contextWindow?.compactionStrategy
      );
      messages = contextWindowResult.messages;
      yield* emitContextWindowEvents(contextWindowResult, emit);
    }

    const guardrails = inputGuardrails?.input ?? [];
    if (guardrails.length > 0) {
      try {
        yield* Effect.promise(() => runInputGuardrails(input, guardrails, messages));
      } catch (error: unknown) {
        if (error instanceof GuardrailError) {
          yield* emit({
            reason: error.reason,
            timestamp: Date.now(),
            type: "guardrail.input.blocked",
          });
          yield* emit({
            from: "Executing",
            timestamp: Date.now(),
            to: "Error",
            type: "agent.transition",
          });
        }
        throw error;
      }
    }

    return { effectivePrompt, messages };
  });
}
