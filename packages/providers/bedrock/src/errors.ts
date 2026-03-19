import { ProviderError, type ProviderErrorCode } from "@obsku/framework";

export class BedrockError extends ProviderError {
  constructor(code: Exclude<ProviderErrorCode, "network">, message: string, cause?: unknown) {
    super(code, message, undefined, cause);
    this.name = "BedrockError";
  }
}

export function mapAwsError(err: unknown): BedrockError {
  const error = err as { message?: string; name?: string };
  if (error.name === "ThrottlingException" || error.name === "TooManyRequestsException") {
    return new BedrockError("throttle", error.message ?? "Rate limited", err);
  }
  if (error.name === "AccessDeniedException" || error.name === "UnrecognizedClientException") {
    return new BedrockError("auth", error.message ?? "Authentication failed", err);
  }
  if (error.name === "ModelNotReadyException") {
    return new BedrockError("model", error.message ?? "Model not available", err);
  }
  return new BedrockError("unknown", error.message ?? "Unknown error", err);
}
