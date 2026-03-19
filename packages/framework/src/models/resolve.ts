import { debugLog } from "../telemetry/log";
import { getErrorMessage } from "../utils";
import type { ModelRegistry } from "./registry";

/**
 * Shared model configuration resolution.
 *
 * Priority:
 *  1. Explicit config values (both must be set to short-circuit)
 *  2. ModelRegistry lookup (errors logged, not thrown)
 *  3. Throw if still unresolved
 */
export async function resolveModelConfig(
  model: string,
  config: { contextWindowSize?: number; maxOutputTokens?: number },
  registry: ModelRegistry
): Promise<{ contextWindowSize: number; maxOutputTokens: number }> {
  if (config.contextWindowSize !== undefined && config.maxOutputTokens !== undefined) {
    return { contextWindowSize: config.contextWindowSize, maxOutputTokens: config.maxOutputTokens };
  }

  const registryInfo = await registry.resolve(model).catch((error) => {
    debugLog(`ModelRegistry resolve failed for ${model}: ${getErrorMessage(error)}`);
    return undefined;
  });

  const contextWindowSize =
    config.contextWindowSize ??
    registryInfo?.contextWindowSize ??
    (() => {
      throw new Error(
        `Unknown model "${model}": cannot determine contextWindowSize. Pass contextWindowSize explicitly.`
      );
    })();

  const maxOutputTokens =
    config.maxOutputTokens ??
    registryInfo?.maxOutputTokens ??
    (() => {
      throw new Error(
        `Unknown model "${model}": cannot determine maxOutputTokens. Pass maxOutputTokens explicitly.`
      );
    })();

  return { contextWindowSize, maxOutputTokens };
}
