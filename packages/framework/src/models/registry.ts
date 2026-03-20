import { DEFAULTS } from "../defaults";
import { fetchLiteLLMModels } from "./litellm-fetcher";
import type { ModelInfo } from "./types";

export interface ModelRegistryOptions {
  fetchTimeoutMs?: number; // default: DEFAULTS.modelRegistry.fetchTimeout
  ttlMs?: number; // default: DEFAULTS.modelRegistry.ttl
}

interface CacheEntry {
  data: ModelInfo;
  fetchedAt: number;
}

function normalizeModelId(modelId: string): string {
  return modelId
    .replace(/^global\./, "")
    .replace(/^us\./, "")
    .replace(/^eu\./, "")
    .replace(/^apac\./, "");
}

/**
 * Strip date+version suffix from Bedrock-style model IDs.
 * e.g. "anthropic.claude-sonnet-4-5-20250929-v1:0" → "anthropic.claude-sonnet-4-5"
 *      "anthropic.claude-opus-4-6-v1" → "anthropic.claude-opus-4-6"
 *      "anthropic.claude-sonnet-4-6" → "anthropic.claude-sonnet-4-6" (no change)
 */
function stripVersionSuffix(modelId: string): string {
  return modelId.replace(/-(?:\d{8}-)?v[\d:.]+$/, "");
}

export class ModelRegistry {
  private cache = new Map<string, CacheEntry>();
  private fetchPromise: Promise<void> | null = null;
  private options: Required<ModelRegistryOptions>;

  constructor(options?: ModelRegistryOptions) {
    this.options = {
      fetchTimeoutMs: options?.fetchTimeoutMs ?? DEFAULTS.modelRegistry.fetchTimeout,
      ttlMs: options?.ttlMs ?? DEFAULTS.modelRegistry.ttl,
    };
  }

  async resolve(modelId: string): Promise<ModelInfo | undefined> {
    const normalized = normalizeModelId(modelId);
    const cached = this.freshEntry(normalized);
    if (cached) {
      return cached;
    }

    await this.fetchWithDedup();

    return this.freshEntry(normalized) ?? this.freshEntry(stripVersionSuffix(normalized));
  }

  resolveSync(modelId: string): ModelInfo | undefined {
    const normalized = normalizeModelId(modelId);
    return this.freshEntry(normalized) ?? this.freshEntry(stripVersionSuffix(normalized));
  }

  private freshEntry(key: string): ModelInfo | undefined {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.fetchedAt < this.options.ttlMs) {
      return entry.data;
    }
    return undefined;
  }

  private async fetchWithDedup(): Promise<void> {
    if (this.fetchPromise) {
      return this.fetchPromise;
    }
    this.fetchPromise = this.doFetch();
    try {
      await this.fetchPromise;
    } finally {
      this.fetchPromise = null;
    }
  }

  private async doFetch(): Promise<void> {
    const result = await fetchLiteLLMModels(
      DEFAULTS.modelRegistry.litellmUrl,
      this.options.fetchTimeoutMs
    );

    // Keep stale cache on fetch failure
    if (!result.ok) {
      return;
    }

    const models = result.data;
    const fetchedAt = Date.now();
    for (const [id, entry] of Object.entries(models)) {
      if (entry.mode !== "chat") {
        continue;
      }
      if (!entry.max_input_tokens || !entry.max_output_tokens) {
        continue;
      }

      const normalized = normalizeModelId(id);
      const cacheEntry: CacheEntry = {
        data: {
          contextWindowSize: entry.max_input_tokens,
          maxOutputTokens: entry.max_output_tokens,
        },
        fetchedAt,
      };

      this.cache.set(normalized, cacheEntry);

      // Also cache under base name (version stripped) for fuzzy lookup.
      // Don't overwrite — prefer the first (most specific) entry.
      const baseName = stripVersionSuffix(normalized);
      if (baseName !== normalized && !this.cache.has(baseName)) {
        this.cache.set(baseName, cacheEntry);
      }
    }
  }
}

export const defaultRegistry = new ModelRegistry();
