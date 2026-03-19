/**
 * OpenAI provider factory for AI SDK adapter.
 *
 * Creates LLMProvider instances backed by @ai-sdk/openai.
 * API key is read from OPENAI_API_KEY environment variable.
 */

import { createOpenAI } from "@ai-sdk/openai";
import type { LLMProvider } from "@obsku/framework";
import { defaultRegistry, resolveModelConfig } from "@obsku/framework/models";

import { fromAiSdk } from "../adapter";
import type { BaseProviderConfig } from "./types";

/**
 * Creates an OpenAI LLM provider.
 *
 * @param config - Provider configuration
 * @returns LLMProvider instance for use with @obsku/framework
 *
 * @example
 * ```typescript
 * import { openai } from "@obsku/provider-ai-sdk";
 * import { agent } from "@obsku/framework";
 *
 * const provider = await openai({ model: "gpt-4o" });
 * const assistant = agent({ name: "assistant", prompt: "You are helpful." });
 * const result = await assistant.run("Hello!", provider);
 * ```
 */
export async function openai(config: BaseProviderConfig): Promise<LLMProvider> {
  const openaiClient = createOpenAI();
  const model = openaiClient(config.model);
  const { contextWindowSize, maxOutputTokens } = await resolveModelConfig(
    config.model,
    config,
    defaultRegistry
  );

  return fromAiSdk(model, { contextWindowSize, maxOutputTokens });
}
