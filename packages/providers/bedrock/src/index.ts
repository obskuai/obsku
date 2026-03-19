export type { EmbeddingProvider, LLMProvider, McpProvider } from "@obsku/framework";
export { fromBedrockContent, toBedrockMessages, toBedrockTools } from "./converters";
export { BedrockEmbedding, type BedrockEmbeddingConfig, BedrockEmbeddingError } from "./embedding";
export { BedrockError, mapAwsError } from "./errors";
export { buildCommandConfig } from "./command-builder";

import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ConverseStreamOutput,
} from "@aws-sdk/client-bedrock-runtime";

import {
  type ChatOptions,
  type LLMProvider,
  type LLMResponse,
  type LLMStreamEvent,
  type Message,
  type ToolDef,
} from "@obsku/framework";
import { defaultRegistry, resolveModelConfig } from "@obsku/framework/models";
import { buildCommandConfig } from "./command-builder";
import { BedrockError, mapAwsError } from "./errors";
import { chatWithFallback } from "./response-parser";
import { mapStreamEvent } from "./stream-handler";



export interface BedrockConfig {
  contextWindowSize?: number;
  maxOutputTokens?: number;
  model: string;
  region?: string;
  /** Enable Extended Thinking for Claude 4 models (thinking budget in tokens) */
  thinkingBudgetTokens?: number;
}

export async function bedrock(config: BedrockConfig): Promise<LLMProvider> {
  const region = config.region ?? process.env.AWS_REGION;
  if (!region) {
    throw new Error("region is required: pass in BedrockConfig or set AWS_REGION env var");
  }
  const { contextWindowSize, maxOutputTokens } = await resolveModelConfig(
    config.model,
    config,
    defaultRegistry
  );

  const client = new BedrockRuntimeClient({ region });
  const cache = new Map<string, boolean>();

  return {
    async chat(
      messages: Array<Message>,
      tools?: Array<ToolDef>,
      options?: ChatOptions
    ): Promise<LLMResponse> {
      const responseFormat = options?.responseFormat;
      const isCachedUnsupported = cache.get(config.model) === false;
      const shouldUseStructuredOutput = !!responseFormat && !isCachedUnsupported;

      const buildCommand = (includeOutputConfig: boolean) =>
        new ConverseCommand(
          buildCommandConfig(
            config.model,
            maxOutputTokens,
            messages,
            tools,
            config.thinkingBudgetTokens,
            includeOutputConfig ? responseFormat : undefined
          )
        );

      return chatWithFallback(client, buildCommand, shouldUseStructuredOutput, config.model, cache);
    },
    async *chatStream(
      messages: Array<Message>,
      tools?: Array<ToolDef>
    ): AsyncIterable<LLMStreamEvent> {
      const command = new ConverseStreamCommand(
        buildCommandConfig(config.model, maxOutputTokens, messages, tools)
      );

      let stream: AsyncIterable<ConverseStreamOutput>;
      try {
        const response = await client.send(command);
        if (!response.stream) {
          throw new BedrockError("unknown", "No stream in response");
        }
        stream = response.stream as AsyncIterable<ConverseStreamOutput>;
    } catch (error: unknown) {
        if (error instanceof BedrockError) {
          throw error;
        }
        throw mapAwsError(error);
      }

      for await (const event of stream) {
        const mapped = mapStreamEvent(event);
        for (const ev of mapped) {
          yield ev;
        }
      }
    },

    contextWindowSize,
    maxOutputTokens,
  };
}
