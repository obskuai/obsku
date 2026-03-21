import { defaultPolicy } from "./default-policy";
import type { OutputPolicy, OutputPolicyFactory } from "./types";

/**
 * Built-in framework event output modes.
 */
export type OutputMode = "default" | "strands";

/**
 * Configures which built-in output policy should be used.
 */
export interface OutputPolicyConfig {
  readonly mode?: OutputMode;
}

const DEFAULT_OUTPUT_MODE: OutputMode = "default";

const BUILT_IN_POLICY_FACTORIES: Partial<Record<OutputMode, OutputPolicyFactory>> = {
  default: {
    create: () => defaultPolicy,
  },
};

/**
 * Resolves the active output mode.
 * Precedence: `OBSKU_OUTPUT_MODE` > `config.mode` > `"default"`.
 */
export function resolveOutputMode(config?: OutputPolicyConfig): OutputMode {
  const envMode = process.env.OBSKU_OUTPUT_MODE;

  if (envMode === "default" || envMode === "strands") {
    return envMode;
  }

  if (config?.mode !== undefined) {
    return config.mode;
  }

  return DEFAULT_OUTPUT_MODE;
}

export function getOutputPolicyFactory(mode: OutputMode): OutputPolicyFactory {
  const factory = BUILT_IN_POLICY_FACTORIES[mode];

  if (!factory) {
    throw new Error(`Output mode '${mode}' requires adapter-owned policy registration`);
  }

  return factory;
}

export function createPolicyInstance(mode: OutputMode): OutputPolicy {
  return getOutputPolicyFactory(mode).create();
}

/**
 * Returns the built-in policy implementation for a resolved mode.
 */
export function getOutputPolicy(mode: OutputMode): OutputPolicy {
  return createPolicyInstance(mode);
}
