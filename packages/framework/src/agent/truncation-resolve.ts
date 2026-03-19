import type { BlobStore } from "../blob/types";
import { DEFAULTS } from "../defaults";
import type { TruncationConfig } from "../types/truncation-config";

/**
 * Result type for truncation resolution.
 * - `active: false` → Truncation is disabled
 * - `active: true` → Truncation is enabled with resolved threshold and optional blobStore
 */
export type ResolvedTruncation =
  | { active: false }
  | { active: true; config: { blobStore?: BlobStore; threshold: number } };

/**
 * Resolve truncation configuration into an active/disabled state.
 *
 * Activation logic:
 * - No config → `{ active: false }`
 * - `enabled: false` → `{ active: false }`
 * - `enabled: true` OR (`blobStore !== undefined` OR `threshold !== undefined`) → resolve threshold
 *
 * Threshold resolution:
 * - Uses `config.threshold` if explicitly set
 * - Falls back to computed value: `Math.floor((providerContextWindowSize * DEFAULTS.preview.truncationRatio) / 4)`
 *
 * @throws Error if active but threshold cannot be resolved (no explicit threshold and no providerContextWindowSize)
 */
export function resolveTruncation(
  config: TruncationConfig | undefined,
  providerContextWindowSize: number | undefined
): ResolvedTruncation {
  if (!config) {
    return { active: false };
  }

  const hasExplicitConfig = config.blobStore !== undefined || config.threshold !== undefined;
  const isActive = config.enabled === true || (config.enabled !== false && hasExplicitConfig);

  if (!isActive) {
    return { active: false };
  }

  // If threshold is explicitly set, use it
  if (config.threshold !== undefined) {
    return {
      active: true,
      config: {
        blobStore: config.blobStore,
        threshold: config.threshold,
      },
    };
  }

  // Otherwise, compute from providerContextWindowSize
  if (providerContextWindowSize === undefined || providerContextWindowSize <= 0) {
    throw new Error(
      "Truncation enabled but threshold cannot be resolved. Set truncation.threshold or use a provider with contextWindowSize."
    );
  }

  const threshold = Math.floor((providerContextWindowSize * DEFAULTS.preview.truncationRatio) / 4);

  return {
    active: true,
    config: {
      blobStore: config.blobStore,
      threshold,
    },
  };
}
