/**
 * Error normalization utilities
 *
 * Centralized helpers for error-to-string conversion, error classification,
 * and error property extraction. Used across framework and benchmark packages.
 */

/** HTTP status codes indicating provider instability (rate limits, server errors) */
const PROVIDER_INSTABILITY_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/** Network error codes indicating connectivity issues */
export const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNABORTED",
]);

/**
 * Convert an unknown value to a Record for property inspection.
 * Returns undefined if the value is not a non-null object.
 */
export function toErrorRecord(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  return error as Record<string, unknown>;
}

/**
 * Extract a human-readable message from an unknown error value.
 * Prefers Error.message, falls back to JSON.stringify, then String().
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Extract stack trace from an unknown error value.
 * Returns undefined if the error is not an Error instance.
 */
export function getErrorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/**
 * Error classification categories for retry and reporting logic.
 */
export type ErrorClass = "provider_instability" | "framework_regression";

function extractHttpStatus(
  record: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined
): number | undefined {
  if (typeof metadata?.["httpStatusCode"] === "number") return metadata["httpStatusCode"];
  if (typeof record?.["statusCode"] === "number") return record["statusCode"];
  if (typeof record?.["status"] === "number") return record["status"];
  return undefined;
}

/**
 * Classify an error to determine handling strategy.
 * Detects provider instability (HTTP 429/500/502/503/504, network errors)
 * vs framework regressions.
 */
export function classifyError(error: unknown): ErrorClass {
  const record = toErrorRecord(error);
  const metadata = toErrorRecord(record?.["$metadata"]);
  const httpStatus = extractHttpStatus(record, metadata);

  if (httpStatus !== undefined && PROVIDER_INSTABILITY_STATUS_CODES.has(httpStatus)) {
    return "provider_instability";
  }

  const code = typeof record?.["code"] === "string" ? record["code"] : undefined;
  if (code && NETWORK_ERROR_CODES.has(code)) {
    return "provider_instability";
  }

  const name = typeof record?.["name"] === "string" ? record["name"] : undefined;
  if (name === "AbortError" || name === "TimeoutError") {
    return record?.["isProviderTimeout"] === true ? "provider_instability" : "framework_regression";
  }

  if (record?.["isProviderInstability"] === true) return "provider_instability";
  if (name === "AssertionError") return "framework_regression";
  return "framework_regression";
}

/**
 * Determine if an error is eligible for retry.
 * Checks for provider errors with network/throttle codes and provider instability.
 */
export function isRetryEligible(error: unknown): boolean {
  const record = toErrorRecord(error);
  const code = typeof record?.["code"] === "string" ? record["code"] : undefined;
  const statusCode = typeof record?.["statusCode"] === "number" ? record["statusCode"] : undefined;
  const name = typeof record?.["name"] === "string" ? record["name"] : undefined;

  if (name === "ProviderError") {
    return code === "network" || code === "throttle" || statusCode === 429;
  }

  return classifyError(error) === "provider_instability";
}
