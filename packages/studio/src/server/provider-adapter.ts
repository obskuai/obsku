import type { LLMProvider } from "@obsku/framework";

/**
 * Supported provider IDs for Studio
 */
export type StudioProviderId = "bedrock" | "anthropic" | "google" | "groq" | "openai";

/**
 * A detected provider package with its available provider IDs
 */
export interface DetectedProvider {
  package: string;
  providerIds: string[];
}

/**
 * Information about a studio provider
 */
export interface StudioProviderInfo {
  id: StudioProviderId;
  name: string;
  detected: boolean;
  defaultModel: string;
  models: string[];
}

/**
 * Adapter interface for creating and managing LLM providers
 */
export interface StudioProviderAdapter {
  id: StudioProviderId;
  name: string;
  createProvider: (model: string) => Promise<LLMProvider>;
  getDefaultModel: () => string;
  listModels: () => string[];
}

/**
 * Result of provider resolution
 */
export interface ProviderResolution {
  provider: StudioProviderAdapter;
  source: "config" | "heuristic" | "fallback";
}

/**
 * Internal configuration for a known provider
 */
interface ProviderConfig {
  name: string;
  package: string;
  factory: string;
  defaultModel: string;
  models: string[];
}

/**
 * Map of known providers with their configurations
 */
export const KNOWN_PROVIDERS: Map<StudioProviderId, ProviderConfig> = new Map([
  [
    "bedrock",
    {
      name: "Amazon Bedrock",
      package: "@obsku/provider-bedrock",
      factory: "@obsku/provider-bedrock",
      defaultModel: "amazon.nova-lite-v1:0",
      models: [
        "amazon.nova-lite-v1:0",
        "anthropic.claude-3-sonnet-20240229-v1:0",
        "anthropic.claude-3-5-sonnet-20241022-v2:0",
        "meta.llama3-1-405b-instruct-v1:0",
      ],
    },
  ],
  [
    "anthropic",
    {
      name: "Anthropic",
      package: "@obsku/provider-ai-sdk",
      factory: "@obsku/provider-ai-sdk/providers/anthropic",
      defaultModel: "claude-sonnet-4-20250514",
      models: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022"],
    },
  ],
  [
    "google",
    {
      name: "Google AI",
      package: "@obsku/provider-ai-sdk",
      factory: "@obsku/provider-ai-sdk/providers/google",
      defaultModel: "gemini-2.0-flash",
      models: ["gemini-2.0-flash", "gemini-1.5-pro"],
    },
  ],
  [
    "groq",
    {
      name: "Groq",
      package: "@obsku/provider-ai-sdk",
      factory: "@obsku/provider-ai-sdk/providers/groq",
      defaultModel: "llama-3.3-70b-versatile",
      models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
    },
  ],
  [
    "openai",
    {
      name: "OpenAI",
      package: "@obsku/provider-ai-sdk",
      factory: "@obsku/provider-ai-sdk/providers/openai",
      defaultModel: "gpt-4o",
      models: ["gpt-4o", "gpt-4o-mini"],
    },
  ],
]);

/**
 * Configuration for provider resolution
 */
export interface ProviderResolutionConfig {
  provider?: string;
  model?: string;
}

/**
 * Resolve the provider based on config and detected providers.
 * Resolution order:
 * 1. If config.provider is set → use that provider (source='config')
 * 2. If exactly 1 unique provider detected → use that (source='heuristic')
 * 3. Otherwise → fallback to bedrock (source='fallback')
 */
export function resolveProvider(
  config: ProviderResolutionConfig,
  detectedProviders: DetectedProvider[]
): ProviderResolution {
  // Flatten all detected provider IDs into a Set
  const detectedIds = new Set<string>();
  for (const dp of detectedProviders) {
    for (const id of dp.providerIds) {
      detectedIds.add(id);
    }
  }

  // Layer 1: Config takes priority
  if (config.provider) {
    const providerConfig = KNOWN_PROVIDERS.get(config.provider as StudioProviderId);
    if (providerConfig) {
      return {
        provider: createAdapter(config.provider as StudioProviderId, config.model),
        source: "config",
      };
    }
  }

  // Layer 2: Heuristic - exactly 1 detected provider
  if (detectedIds.size === 1) {
    const detectedId = Array.from(detectedIds)[0] as StudioProviderId;
    const providerConfig = KNOWN_PROVIDERS.get(detectedId);
    if (providerConfig) {
      return {
        provider: createAdapter(detectedId, config.model),
        source: "heuristic",
      };
    }
  }

  // Layer 3: Fallback to bedrock
  return {
    provider: createAdapter("bedrock", config.model),
    source: "fallback",
  };
}

/**
 * Create a provider adapter for the given provider ID
 */
export function createAdapter(
  providerId: StudioProviderId,
  model?: string
): StudioProviderAdapter {
  const config = KNOWN_PROVIDERS.get(providerId);
  if (!config) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  const selectedModel = model ?? config.defaultModel;

  return {
    id: providerId,
    name: config.name,
    createProvider: async (): Promise<LLMProvider> => {
      if (providerId === "bedrock") {
        const { bedrock } = (await import(config.factory)) as {
          bedrock(options: { model: string }): Promise<LLMProvider>;
        };
        return bedrock({ model: selectedModel });
      } else {
        // AI SDK providers
        const factory = (await import(config.factory)) as {
          [key: string]: (options: { model: string }) => Promise<LLMProvider>;
        };
        // Factory exports named function matching providerId
        const factoryFn = factory[providerId];
        if (!factoryFn) {
          throw new Error(`Factory function ${providerId} not found in ${config.factory}`);
        }
        return factoryFn({ model: selectedModel });
      }
    },
    getDefaultModel: () => config.defaultModel,
    listModels: () => config.models,
  };
}
