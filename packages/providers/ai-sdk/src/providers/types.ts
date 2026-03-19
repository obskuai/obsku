/**
 * Provider factory configuration types for AI SDK adapter.
 *
 * Shared type definitions used by provider factory functions to create
 * LLMProvider instances with proper configuration.
 */

/**
 * Base configuration common to all provider factories.
 * Extends this interface when creating provider-specific config types.
 */
export interface BaseProviderConfig {
  /**
   * Model identifier (e.g., "gpt-4o", "claude-4-opus", etc.)
   *
   * The format depends on the provider - see provider documentation
   * for valid model strings.
   */
  model: string;

  /**
   * Context window size in tokens.
   *
   * Controls the maximum number of tokens the model can process
   * in a single request (input + output).
   */
  contextWindowSize?: number;

  /**
   * Maximum number of output tokens to generate.
   *
   * Controls the response length. Lower values reduce latency and cost.
   */
  maxOutputTokens?: number;
}

/**
 * Anthropic-specific provider configuration.
 *
 * Adds support for Extended Thinking feature available on
 * Claude 3.7+ and Claude 4 models.
 */
export interface AnthropicProviderConfig extends BaseProviderConfig {
  /**
   * Extended Thinking budget in tokens.
   *
   * When set, enables Extended Thinking mode where the model performs
   * extended reasoning before generating a response. The value specifies
   * the maximum tokens allocated for the thinking process.
   *
   * Available on Claude 3.7+ and Claude 4 models only.
   *
   * @see https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
   */
  thinkingBudgetTokens?: number;
}
