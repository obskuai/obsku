import type { ContextWindowConfig } from "../types/context-window-config";

/**
 * Result type for context window resolution.
 * - `active: false` → Context window management is disabled
 * - `active: true` → Context window management is enabled with resolved maxContextTokens
 */
export type ResolvedContextWindow =
  | { active: false }
  | { active: true; config: ContextWindowConfig & { maxContextTokens: number } };

/**
 * Resolve context window configuration into an active/disabled state.
 *
 * Activation logic:
 * - No config → `{ active: false }`
 * - `enabled: false` → `{ active: false }`
 * - `enabled: true` OR `maxContextTokens !== undefined` → resolve maxContextTokens
 *
 * maxContextTokens resolution: `config.maxContextTokens ?? providerContextWindowSize`
 *
 * @throws Error if active but maxContextTokens cannot be resolved or is <= 0
 */
export function resolveContextWindow(
  config: ContextWindowConfig | undefined,
  providerContextWindowSize: number | undefined
): ResolvedContextWindow {
  if (!config) {
    return { active: false };
  }

  const isActive =
    config.enabled === true || (config.enabled !== false && config.maxContextTokens !== undefined);

  if (!isActive) {
    return { active: false };
  }

  const maxContextTokens =
    config.maxContextTokens !== undefined ? config.maxContextTokens : providerContextWindowSize;

  if (maxContextTokens === undefined || maxContextTokens <= 0) {
    throw new Error(
      "Context window management enabled but maxContextTokens cannot be resolved. Set contextWindow.maxContextTokens or use a provider with contextWindowSize."
    );
  }

  return {
    active: true,
    config: {
      ...config,
      maxContextTokens,
    },
  };
}
