/**
 * Google provider factory for AI SDK adapter.
 *
 * Creates LLMProvider instances backed by @ai-sdk/google.
 * API key is read from GOOGLE_GENERATIVE_AI_API_KEY environment variable.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LLMProvider } from "@obsku/framework";
import { defaultRegistry, resolveModelConfig } from "@obsku/framework/models";

import { fromAiSdk } from "../adapter";
import type { BaseProviderConfig } from "./types";

/**
 * Creates a Google Generative AI (Gemini) LLM provider.
 *
 * @param config - Provider configuration
 * @returns LLMProvider instance for use with @obsku/framework
 *
 * @example
 * ```typescript
 * import { google } from "@obsku/provider-ai-sdk";
 * import { agent } from "@obsku/framework";
 *
 * const provider = await google({ model: "gemini-2.0-flash" });
 * const assistant = agent({ name: "assistant", prompt: "You are helpful." });
 * const result = await assistant.run("Hello!", provider);
 * ```
 */
export async function google(config: BaseProviderConfig): Promise<LLMProvider> {
  const googleClient = createGoogleGenerativeAI();
  const model = googleClient(config.model);
  const { contextWindowSize, maxOutputTokens } = await resolveModelConfig(
    config.model,
    config,
    defaultRegistry
  );

  return fromAiSdk(model, { contextWindowSize, maxOutputTokens });
}
