/**
 * Type guard utilities for runtime type checking.
 */

/**
 * Checks if a value is a plain object (Record<string, unknown>).
 * Excludes null, arrays, and other object types like Date, RegExp, etc.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Checks if an error is a NodeJS.ErrnoException (has a code property).
 */
export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}
