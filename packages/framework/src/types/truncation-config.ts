// =============================================================================
// @obsku/framework — Truncation configuration types
// =============================================================================

import type { BlobStore } from "../blob/types";

/**
 * Configuration for tool output truncation.
 * Large tool outputs are truncated and optionally stored in a BlobStore.
 */
export interface TruncationConfig {
  /** BlobStore for storing full tool output when truncated. Optional. */
  blobStore?: BlobStore;
  /** Master switch. Defaults to true if blobStore or threshold is set, false otherwise. */
  enabled?: boolean;
  /** Threshold (characters, not tokens) at which to trigger truncation. */
  threshold?: number;
}

/**
 * Per-plugin truncation configuration.
 * Allows fine-grained control over truncation behavior for individual tools.
 */
export interface PluginTruncationConfig {
  /** false = skip truncation for this tool */
  enabled?: boolean;
  /** false = truncate but don't save to blobStore */
  saveToStore?: boolean;
  /** Per-tool threshold override (characters) */
  threshold?: number;
}

/**
 * Directive for modifying tool output based on pattern matching.
 * Directives can inject additional content into results.
 */
export interface Directive {
  /** Content to inject or function returning content to inject */
  inject: string | ((result: string, input: Record<string, unknown>) => string);
  /** Match function to determine if this directive applies */
  match: (result: string, input: Record<string, unknown>) => boolean;
  /** Optional name for the directive (for debugging/logging) */
  name?: string;
}
