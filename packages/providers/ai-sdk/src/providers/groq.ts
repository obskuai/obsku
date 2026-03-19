/**
 * Groq provider factory for AI SDK adapter.
 *
 * Creates LLMProvider instances backed by @ai-sdk/groq.
 * API key is read from GROQ_API_KEY environment variable.
 */

import { createGroq } from "@ai-sdk/groq";
import type { LLMProvider } from "@obsku/framework";
import { defaultRegistry, resolveModelConfig } from "@obsku/framework/models";

import { fromAiSdk } from "../adapter";
import type { BaseProviderConfig } from "./types";

/**
 * Creates a Groq LLM provider.
 *
 * Groq offers fast inference for open-source models like Llama and Mixtral.
 *
 * @param config - Provider configuration
 * @returns LLMProvider instance for use with @obsku/framework
 *
 * @example
 * ```typescript
 * import { groq } from "@obsku/provider-ai-sdk";
 * import { agent } from "@obsku/framework";
 *
 * const provider = await groq({ model: "llama-3.3-70b-versatile" });
 * const assistant = agent({ name: "assistant", prompt: "You are helpful." });
 * const result = await assistant.run("Hello!", provider);
 * ```
 */
export async function groq(config: BaseProviderConfig): Promise<LLMProvider> {
  const groqClient = createGroq();
  const model = groqClient(config.model);
  const { contextWindowSize, maxOutputTokens } = await resolveModelConfig(
    config.model,
    config,
    defaultRegistry
  );

  return fromAiSdk(model, { contextWindowSize, maxOutputTokens });
}
