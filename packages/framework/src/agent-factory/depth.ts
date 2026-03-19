// =============================================================================
// @obsku/framework — Agent Factory: Depth protection utilities
// =============================================================================
// Isolates AsyncLocalStorage-based nesting depth tracking so that the
// validation concern lives independently from registry management and execution.

import { AsyncLocalStorage } from "node:async_hooks";

// Guard: AsyncLocalStorage may be undefined in bundled environments
export const depthStorage =
  typeof AsyncLocalStorage === "function" ? new AsyncLocalStorage<number>() : undefined;

/**
 * Returns the current agent nesting depth (0 = top-level).
 */
export function getCurrentDepth(): number {
  return depthStorage?.getStore() ?? 0;
}

/**
 * Returns an error message if `currentDepth` meets or exceeds `maxDepth`,
 * or `null` if the call is within the allowed limit.
 */
export function checkDepthLimit(currentDepth: number, maxDepth: number): string | null {
  if (currentDepth >= maxDepth) {
    return `Agent nesting depth exceeded (max: ${maxDepth})`;
  }
  return null;
}

/**
 * Runs `fn` with depth incremented by 1 in the AsyncLocalStorage context.
 * Falls back to a plain call in bundled environments where AsyncLocalStorage
 * is unavailable.
 */
export async function runWithDepth<T>(depth: number, fn: () => Promise<T>): Promise<T> {
  return depthStorage ? depthStorage.run(depth + 1, fn) : fn();
}
