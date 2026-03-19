/**
 * Anthropic provider factory for AI SDK adapter.
 *
 * Creates LLMProvider instances backed by @ai-sdk/anthropic.
 * API key is read from ANTHROPIC_API_KEY environment variable.
 * Supports Extended Thinking for Claude 3.7+ and Claude 4 models.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import type { LLMProvider } from "@obsku/framework";
import { defaultRegistry, resolveModelConfig } from "@obsku/framework/models";

import { fromAiSdk } from "../adapter";
import type { AnthropicProviderConfig } from "./types";

/**
 * Creates an Anthropic LLM provider.
 *
 * @param config - Provider configuration (includes thinkingBudgetTokens for Extended Thinking)
 * @returns LLMProvider instance for use with @obsku/framework
 *
 * @example
 * ```typescript
 * import { anthropic } from "@obsku/provider-ai-sdk";
 * import { agent } from "@obsku/framework";
 *
 * // Basic usage
 * const provider = await anthropic({ model: "claude-sonnet-4-20250514" });
 *
 * // With Extended Thinking
 * const thinkingProvider = await anthropic({
 *   model: "claude-sonnet-4-20250514",
 *   thinkingBudgetTokens: 8000,
 * });
 *
 * const assistant = agent({ name: "assistant", prompt: "You are helpful." });
 * const result = await assistant.run("Hello!", provider);
 * ```
 */
export async function anthropic(config: AnthropicProviderConfig): Promise<LLMProvider> {
  const anthropicClient = createAnthropic();
  const model = anthropicClient(config.model);
  const { contextWindowSize, maxOutputTokens } = await resolveModelConfig(
    config.model,
    config,
    defaultRegistry
  );

  const providerOptions = config.thinkingBudgetTokens
    ? {
        anthropic: {
          thinking: { type: "enabled" as const, budgetTokens: config.thinkingBudgetTokens },
        },
      }
    : undefined;

  return fromAiSdk(model, { contextWindowSize, maxOutputTokens, providerOptions });
}
