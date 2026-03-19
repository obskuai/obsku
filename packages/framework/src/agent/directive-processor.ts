import { Effect } from "effect";
import { GuardrailError } from "../guardrails";
import { runOutputGuardrails } from "../guardrails/runner";
import type { GuardrailFn, LLMResponse, Message, TextContent } from "../types";
import { BlockType } from "../types/constants";
import { buildToolResultMessages, buildToolResultMessagesWithTruncation } from "./message-builder";
import type { EmitFn } from "./tool-executor";
import type { ResolvedTruncation } from "./truncation-resolve";

export type ToolResultWithMeta =
  | {
      injectedMessages?: Array<Message>;
      isError: false;
      result: string;
      toolName?: string;
      toolUseId: string;
    }
  | {
      injectedMessages?: Array<Message>;
      isError: true;
      result: string;
      toolName?: string;
      toolUseId: string;
    };

export function handleTextBlocksAndGuardrails(
  response: LLMResponse,
  outputGuardrails: GuardrailFn[] | undefined,
  messages: Array<Message>,
  emit: EmitFn,
  lastText: string
) {
  return Effect.gen(function* () {
    const textBlocks = response.content.filter((c): c is TextContent => c.type === BlockType.TEXT);
    if (textBlocks.length === 0) {
      return lastText;
    }

    const nextText = textBlocks.map((c) => c.text).join("");
    yield* emit({ content: nextText, timestamp: Date.now(), type: "agent.thinking" });

    if (outputGuardrails && outputGuardrails.length > 0) {
      try {
        yield* Effect.promise(() => runOutputGuardrails(nextText, outputGuardrails, messages));
      } catch (error: unknown) {
        if (error instanceof GuardrailError) {
          yield* emit({
            reason: error.reason,
            timestamp: Date.now(),
            type: "guardrail.output.blocked",
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

    return nextText;
  });
}

export function applyToolResults(
  allResults: Array<ToolResultWithMeta>,
  resolvedTruncation: ResolvedTruncation | undefined,
  messages: Array<Message>,
  emit: EmitFn
) {
  return Effect.gen(function* () {
    const resultMessages = resolvedTruncation?.active
      ? yield* Effect.promise(() =>
          buildToolResultMessagesWithTruncation(allResults, resolvedTruncation)
        )
      : buildToolResultMessages(allResults);
    for (const msg of resultMessages) {
      messages.push(msg);
    }
    for (const result of allResults) {
      for (const injectedMessage of result.injectedMessages ?? []) {
        messages.push(injectedMessage);
      }
    }

    const mergedContent = resultMessages[0]?.content;
    for (let idx = 0; idx < allResults.length; idx++) {
      const result = allResults[idx];
      const contentBlock =
        Array.isArray(mergedContent) && mergedContent[idx]?.type === BlockType.TOOL_RESULT
          ? mergedContent[idx]
          : undefined;
      const displayResult =
        contentBlock && "content" in contentBlock ? contentBlock.content : result.result;
      yield* emit({
        isError: result.isError,
        result: displayResult,
        timestamp: Date.now(),
        toolName: result.toolName ?? "",
        toolUseId: result.toolUseId,
        type: "tool.result",
      });
    }
  });
}
