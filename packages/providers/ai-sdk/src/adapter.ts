import {
  ChatOptions,
  isRecord,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
  Message,
  ToolDef,
} from "@obsku/framework";
import { generateText, type LanguageModelV1, streamText } from "ai";

import { fromAiSdkResponse, toAiSdkMessages, toAiSdkTools } from "./converter";
import { mapAiSdkError } from "./errors";
import { mapAiSdkStopReason } from "./stop-reason";

const DEFAULT_CONTEXT_WINDOW_SIZE = 128_000;

type GenerateTextArgs = Parameters<typeof generateText>[0];
type StreamTextArgs = Parameters<typeof streamText>[0];

type AiSdkTextDeltaPart = { type: "text-delta"; textDelta: string };
type AiSdkToolCallPart = { type: "tool-call"; toolCallId: string; toolName: string; args: unknown };
type AiSdkToolCallStartPart = {
  type: "tool-call-streaming-start";
  toolCallId: string;
  toolName: string;
};
type AiSdkToolCallDeltaPart = {
  type: "tool-call-delta";
  toolCallId: string;
  toolName: string;
  argsTextDelta: string;
};
type AiSdkFinishPart = {
  type: "finish";
  finishReason: string;
  usage: { completionTokens: number; promptTokens: number };
};
type AiSdkErrorPart = { type: "error"; error: unknown };

export interface AdapterConfig {
  contextWindowSize?: number;
  maxOutputTokens?: number;
  providerOptions?: Record<string, unknown>;
}

function isTokenUsage(value: unknown): value is { completionTokens: number; promptTokens: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "promptTokens" in value &&
    typeof value.promptTokens === "number" &&
    "completionTokens" in value &&
    typeof value.completionTokens === "number"
  );
}

function isTextDeltaPart(value: unknown): value is AiSdkTextDeltaPart {
  return isRecord(value) && value.type === "text-delta" && typeof value.textDelta === "string";
}

function isToolCallStartPart(value: unknown): value is AiSdkToolCallStartPart {
  return (
    isRecord(value) &&
    value.type === "tool-call-streaming-start" &&
    typeof value.toolCallId === "string" &&
    typeof value.toolName === "string"
  );
}

function isToolCallDeltaPart(value: unknown): value is AiSdkToolCallDeltaPart {
  return (
    isRecord(value) &&
    value.type === "tool-call-delta" &&
    typeof value.toolCallId === "string" &&
    typeof value.toolName === "string" &&
    typeof value.argsTextDelta === "string"
  );
}

function isToolCallPart(value: unknown): value is AiSdkToolCallPart {
  return (
    isRecord(value) &&
    value.type === "tool-call" &&
    typeof value.toolCallId === "string" &&
    typeof value.toolName === "string"
  );
}

function isFinishPart(value: unknown): value is AiSdkFinishPart {
  return (
    isRecord(value) &&
    value.type === "finish" &&
    typeof value.finishReason === "string" &&
    isTokenUsage(value.usage)
  );
}

function isErrorPart(value: unknown): value is AiSdkErrorPart {
  return isRecord(value) && value.type === "error" && "error" in value;
}

async function* mapStreamEvents(stream: AsyncIterable<unknown>): AsyncIterable<LLMStreamEvent> {
  for await (const part of stream) {
    if (isTextDeltaPart(part)) {
      yield { type: "text_delta", content: part.textDelta };
      continue;
    }

    if (isToolCallStartPart(part)) {
      yield { type: "tool_use_start", name: part.toolName, toolUseId: part.toolCallId };
      continue;
    }

    if (isToolCallDeltaPart(part)) {
      yield { type: "tool_use_delta", input: part.argsTextDelta };
      continue;
    }

    if (isToolCallPart(part)) {
      yield { type: "tool_use_start", name: part.toolName, toolUseId: part.toolCallId };
      yield { type: "tool_use_delta", input: JSON.stringify(part.args ?? {}) };
      yield { type: "tool_use_end" };
      continue;
    }

    if (isFinishPart(part)) {
      yield {
        type: "message_end",
        stopReason: mapAiSdkStopReason(part.finishReason),
        usage: {
          inputTokens: part.usage.promptTokens,
          outputTokens: part.usage.completionTokens,
        },
      };
      continue;
    }

    if (isErrorPart(part)) {
      throw mapAiSdkError(part.error);
    }
  }
}

export function fromAiSdk(model: LanguageModelV1, config?: AdapterConfig): LLMProvider {
  const contextWindowSize = config?.contextWindowSize ?? DEFAULT_CONTEXT_WINDOW_SIZE;
  const maxOutputTokens = config?.maxOutputTokens;
  const providerOptions = config?.providerOptions as GenerateTextArgs["providerOptions"];

  return {
    async chat(
      messages: Array<Message>,
      tools?: Array<ToolDef>,
      _options?: ChatOptions
    ): Promise<LLMResponse> {
      try {
        const prompt = toAiSdkMessages(messages);
        const aiTools = (
          tools && tools.length > 0 ? toAiSdkTools(tools) : undefined
        ) as GenerateTextArgs["tools"];

        const result = await generateText({
          model,
          system: prompt.system,
          messages: prompt.messages,
          tools: aiTools,
          providerOptions,
          maxTokens: maxOutputTokens,
        });

        return fromAiSdkResponse(result);
      } catch (error: unknown) {
        throw mapAiSdkError(error);
      }
    },

    async *chatStream(
      messages: Array<Message>,
      tools?: Array<ToolDef>
    ): AsyncIterable<LLMStreamEvent> {
      try {
        const prompt = toAiSdkMessages(messages);
        const aiTools = (
          tools && tools.length > 0 ? toAiSdkTools(tools) : undefined
        ) as StreamTextArgs["tools"];

        const result = streamText({
          model,
          system: prompt.system,
          messages: prompt.messages,
          tools: aiTools,
          providerOptions: providerOptions as StreamTextArgs["providerOptions"],
          maxTokens: maxOutputTokens,
        });

        yield* mapStreamEvents(result.fullStream as AsyncIterable<unknown>);
      } catch (error: unknown) {
        throw mapAiSdkError(error);
      }
    },

    contextWindowSize,
    maxOutputTokens,
  };
}
