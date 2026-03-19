import { ProviderError, type ProviderErrorCode, NETWORK_ERROR_CODES } from "@obsku/framework";

export class AiSdkError extends ProviderError {
  constructor(code: ProviderErrorCode, message: string, statusCode?: number, cause?: unknown) {
    super(code, message, statusCode, cause);
    this.name = "AiSdkError";
  }
}

interface ErrorWithStatusCode {
  statusCode?: number;
}

interface ErrorWithName {
  name?: string;
  message?: string;
}

interface ErrorWithCode {
  code?: string;
}

/**
 * Map AI SDK errors to ProviderError codes.
 *
 * Error mappings:
 * - Rate limit (429 statusCode) / APICallError with isRetryable → "throttle"
 * - Auth errors (401, 403) / LoadAPIKeyError → "auth"
 * - Model errors / NoSuchModelError → "model"
 * - Network errors (ECONNREFUSED, etc.) → "network"
 * - Everything else → "unknown"
 */
export function mapAiSdkError(error: unknown): AiSdkError {
  // Handle null/undefined
  if (error == null) {
    return new AiSdkError("unknown", "Unknown error", undefined, error);
  }

  const errorRecord = error as ErrorWithStatusCode & ErrorWithName & ErrorWithCode;

  const statusCode = errorRecord.statusCode;
  const name = errorRecord.name;
  const message = (errorRecord.message && errorRecord.message.trim()) || "Unknown error";
  const code = errorRecord.code;

  // Check for network errors first (code-based)
  if (code && NETWORK_ERROR_CODES.has(code)) {
    return new AiSdkError("network", message, undefined, error);
  }

  // Check for rate limiting / throttling
  if (statusCode === 429) {
    return new AiSdkError("throttle", message, statusCode, error);
  }

  // Check for auth errors (401, 403)
  if (statusCode === 401 || statusCode === 403) {
    return new AiSdkError("auth", message, statusCode, error);
  }

  // Check for specific AI SDK error types by name
  if (name === "LoadAPIKeyError") {
    return new AiSdkError("auth", message, statusCode, error);
  }

  if (name === "NoSuchModelError" || name === "InvalidPromptError") {
    return new AiSdkError("model", message, statusCode, error);
  }

  if (name === "APICallError") {
    // APICallError with 5xx status codes → throttle (provider instability)
    if (statusCode && statusCode >= 500 && statusCode < 600) {
      return new AiSdkError("throttle", message, statusCode, error);
    }
    // APICallError with 4xx status codes → unknown (client error)
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return new AiSdkError("unknown", message, statusCode, error);
    }
  }

  // Default to unknown
  return new AiSdkError("unknown", message, statusCode, error);
}
