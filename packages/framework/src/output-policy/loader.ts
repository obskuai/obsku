import {
  createPolicyInstance,
  getOutputPolicyFactory,
  type OutputMode,
  type OutputPolicyConfig,
  resolveOutputMode,
} from "./resolve";
import type { OutputPolicy, OutputPolicyFactory } from "./types";

/**
 * Result of loading an output policy, including both the policy
 * implementation and the resolved mode.
 */
export interface LoadedPolicy {
  readonly factory: OutputPolicyFactory;
  readonly policy: OutputPolicy;
  readonly mode: OutputMode;
  createPolicy(): OutputPolicy;
}

/**
 * Options for loading an output policy.
 */
export interface LoadOutputPolicyOptions {
  /** Explicit config to use (lower precedence than env var) */
  readonly config?: OutputPolicyConfig;
}

/**
 * Load the active output policy based on environment, config, and defaults.
 *
 * Resolution precedence (highest to lowest):
 * 1. `OBSKU_OUTPUT_MODE` environment variable
 * 2. `options.config.mode` if provided
 * 3. Default mode ("default")
 *
 * @param options - Optional configuration
 * @returns The loaded policy and resolved mode
 *
 * @example
 * ```typescript
 * // Load with defaults
 * const { policy, mode } = loadOutputPolicy();
 * ```
 */
export function loadOutputPolicy(options?: LoadOutputPolicyOptions): LoadedPolicy {
  const mode = resolveOutputMode(options?.config);
  const factory = getOutputPolicyFactory(mode);
  const createPolicy = () => createPolicyInstance(mode);
  const policy = createPolicy();

  return {
    factory,
    policy,
    mode,
    createPolicy,
  };
}
