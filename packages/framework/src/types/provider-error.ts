export type ProviderErrorCode = "throttle" | "auth" | "model" | "network" | "unknown";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly statusCode?: number;

  constructor(code: ProviderErrorCode, message: string, statusCode?: number, cause?: unknown) {
    super(message, { cause });
    this.name = "ProviderError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
