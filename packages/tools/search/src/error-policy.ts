/**
 * IO error policy for filesystem traversal.
 *
 * - ENOENT  → skip silently (expected: symlink targets, dirs deleted mid-traversal)
 * - EACCES / EMFILE → log warning, continue traversal
 * - other   → surface to caller (unexpected; should not be swallowed)
 */
import { debugLog } from "@obsku/framework";

export type IoErrorClass = "skip" | "warn" | "surface";

export function classifyIoError(error: unknown): IoErrorClass {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: string }).code;
    if (code === "ENOENT") {
      return "skip";
    }
    if (code === "EACCES" || code === "EMFILE") {
      return "warn";
    }
  }
  return "surface";
}

/**
 * Handle a traversal error according to the explicit IO error policy.
 * Returns `collected` for skip/warn, throws for surface-class errors.
 */
export function handleTraversalError<T>(
  error: unknown,
  dirPath: string,
  collected: Array<T>
): Array<T> {
  const cls = classifyIoError(error);

  if (cls === "skip") {
    // ENOENT: directory deleted or symlink target missing — silently skip
    return collected;
  }

  if (cls === "warn") {
    const code = (error as { code: string }).code;
    // EACCES / EMFILE: permission or fd exhaustion — log and continue
    debugLog(`[findFilesRecursive] Unexpected error in ${dirPath}: ${code}`);
    return collected;
  }

  // surface: unknown IO error — rethrow so caller can decide
  throw error;
}
