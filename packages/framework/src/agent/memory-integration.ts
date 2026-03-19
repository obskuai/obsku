import { defaultOnEntityExtract } from "../memory/hooks/on-entity-extract";
import { defaultOnMemoryLoad } from "../memory/hooks/on-memory-load";
import { defaultOnMemorySave } from "../memory/hooks/on-memory-save";
import type { Entity, MemoryHookContext, MemoryInjection } from "../memory/types";
import { debugLog } from "../telemetry";
import type { LLMProvider, LLMResponse, Logger, MemoryConfig, Message } from "../types";

type MemoryFeatureKey = "contextInjection" | "entityMemory" | "longTermMemory";
type MemoryEventBus = { emit: (event: { payload: unknown; type: string }) => void };
type LoadHook = (ctx: MemoryHookContext) => Promise<MemoryInjection>;
type ExtractHook = (ctx: MemoryHookContext & { response: LLMResponse }) => Promise<Array<Entity>>;
type SaveHook = (ctx: MemoryHookContext) => Promise<void>;

interface ApplyMemoryErrorPolicyOptions<T> {
  error: unknown;
  hookName: string;
  config: MemoryConfig;
  fallback?: T | null;
  logger?: Logger;
  eventBus?: MemoryEventBus;
}

// ─── Policy gates ───────────────────────────────────────────────────────────

/**
 * Check if a memory hook should run based on configuration.
 * Returns false if memory is disabled, the feature flag is off, or no store.
 */
function shouldRunMemoryHook(config: MemoryConfig, featureKey: MemoryFeatureKey): boolean {
  if (!config.enabled) {
    return false;
  }
  if (config[featureKey] === false) {
    return false;
  }
  if (!config.store) {
    return false;
  }
  return true;
}

// ─── Error policy and fallback shaping ─────────────────────────────────────

/**
 * Apply error policy from config and return the fallback value.
 * - "throw": re-throws the error
 * - "log": logs to stderr, telemetry, and optionally eventBus, then returns fallback
 * - "ignore": silently returns fallback
 * Always calls config.errorHandler if provided.
 */
function applyMemoryErrorPolicy<T>({
  error,
  hookName,
  config,
  fallback = null,
  logger,
  eventBus,
}: ApplyMemoryErrorPolicyOptions<T>): T | null {
  const policy = config.onHookError ?? "log";

  const normalizedError = error instanceof Error ? error : new Error(String(error));

  if (policy === "throw") {
    throw normalizedError;
  }

  if (policy === "log") {
    const msg = `[Memory Hook Error] ${hookName}: ${normalizedError.message}`;
    if (logger) {
      logger.error(msg);
    }

    debugLog(
      `memory_hook_failed: ${hookName} (${normalizedError.name}): ${normalizedError.message}`
    );

    if (eventBus) {
      eventBus.emit({
        payload: {
          errorMessage: normalizedError.message,
          errorType: normalizedError.name,
          hookName,
          policy,
        },
        type: "memory_hook_failed",
      });
    }
  }

  if (config.errorHandler) {
    config.errorHandler(normalizedError, hookName);
  }

  return fallback;
}

/**
 * Select and invoke the memory load hook.
 * Uses config.hooks.onMemoryLoad if provided, otherwise the default implementation.
 */
function resolveLoadHook(config: MemoryConfig): LoadHook {
  const hook = config.hooks?.onMemoryLoad ?? defaultOnMemoryLoad;

  return async (ctx) =>
    hook(ctx, {
      maxContextLength: config.maxContextLength,
      maxEntitiesPerSession: config.maxEntitiesPerSession,
      maxFactsToInject: config.maxFactsToInject,
    });
}

/**
 * Select and invoke the entity extract hook.
 * Uses config.hooks.onEntityExtract if provided, otherwise the default.
 * Respects config.extractionProvider for cheaper-model extraction.
 */
function resolveExtractHook(config: MemoryConfig, provider: LLMProvider): ExtractHook {
  const hook = config.hooks?.onEntityExtract;
  if (hook) {
    return async (ctx) => hook(ctx);
  }

  const extractionProvider = config.extractionProvider ?? provider;

  return async (ctx) => defaultOnEntityExtract(ctx, extractionProvider);
}

/**
 * Select and invoke the memory save hook.
 * Uses config.hooks.onMemorySave if provided, otherwise the default.
 * Respects config.extractionProvider for cheaper-model extraction.
 */
function resolveSaveHook(config: MemoryConfig, provider: LLMProvider): SaveHook {
  const hook = config.hooks?.onMemorySave;
  if (hook) {
    return async (ctx) => {
      await hook(ctx);
    };
  }

  const extractionProvider = config.extractionProvider ?? provider;

  return async (ctx) => {
    await defaultOnMemorySave(ctx, extractionProvider);
  };
}

async function runMemoryHook<T>(options: {
  config: MemoryConfig;
  execute: () => Promise<T>;
  fallback: T;
  featureKey: MemoryFeatureKey;
  hookName: string;
  logger?: Logger;
}): Promise<T> {
  const { config, execute, fallback, featureKey, hookName, logger } = options;

  if (!shouldRunMemoryHook(config, featureKey)) {
    return fallback;
  }

  try {
    return await execute();
  } catch (error: unknown) {
    return applyMemoryErrorPolicy({ error, hookName, config, fallback, logger }) as T;
  }
}

// ─── Execution Orchestration ──────────────────────────────────────────────

/**
 * Execute memory load hook at agent start.
 * Loads entities/facts and returns context to inject into prompt.
 * @returns MemoryInjection or null if disabled/error
 */
export async function executeMemoryLoad(
  config: MemoryConfig,
  ctx: MemoryHookContext,
  logger?: Logger
): Promise<MemoryInjection | null> {
  const hook = resolveLoadHook(config);

  return runMemoryHook({
    config,
    execute: () => hook(ctx),
    fallback: null,
    featureKey: "contextInjection",
    hookName: "onMemoryLoad",
    logger,
  });
}

/**
 * Execute entity extraction hook after LLM response.
 * Extracts and saves entities from the response.
 * @returns Array of extracted entities or empty array on disabled/error
 */
export async function executeEntityExtract(
  config: MemoryConfig,
  ctx: MemoryHookContext & { response: LLMResponse },
  provider: LLMProvider,
  logger?: Logger
): Promise<Array<Entity>> {
  const hook = resolveExtractHook(config, provider);

  return runMemoryHook({
    config,
    execute: () => hook(ctx),
    fallback: [],
    featureKey: "entityMemory",
    hookName: "onEntityExtract",
    logger,
  });
}

/**
 * Execute memory save hook at agent end.
 * Summarizes conversation and extracts long-term facts.
 * Returns void — errors are handled via policy, never propagated.
 */
export async function executeMemorySave(
  config: MemoryConfig,
  ctx: MemoryHookContext,
  provider: LLMProvider,
  logger?: Logger
): Promise<void> {
  const hook = resolveSaveHook(config, provider);

  await runMemoryHook({
    config,
    execute: () => hook(ctx),
    fallback: undefined,
    featureKey: "longTermMemory",
    hookName: "onMemorySave",
    logger,
  });
}

// ─── Context Factory ──────────────────────────────────────────────────────

/**
 * Build memory hook context for use with memory hooks.
 * Validates that a store is present before constructing the context.
 */
export function buildMemoryHookContext(
  sessionId: string,
  agentName: string,
  messages: Array<Message>,
  config: MemoryConfig,
  input?: string,
  workspaceId?: string
): MemoryHookContext {
  if (!config.store) {
    throw new Error("buildMemoryHookContext requires config.store");
  }

  return {
    agentName,
    embeddingProvider: config.embeddingProvider,
    input,
    messages,
    sessionId,
    store: config.store,
    workspaceId,
  };
}
