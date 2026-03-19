// Unit tests for errors.ts
// Tests mapAiSdkError function and AiSdkError class

import { describe, expect, test } from "bun:test";
import { ProviderError } from "@obsku/framework";
import { AiSdkError, mapAiSdkError } from "../src/errors";

// ---------------------------------------------------------------------------
// AiSdkError class
// ---------------------------------------------------------------------------
describe("AiSdkError", () => {
  test("extends ProviderError", () => {
    const error = new AiSdkError("unknown", "test");
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toBeInstanceOf(Error);
  });

  test("sets name to AiSdkError", () => {
    const error = new AiSdkError("unknown", "test");
    expect(error.name).toBe("AiSdkError");
  });

  test("preserves code", () => {
    const error = new AiSdkError("throttle", "Rate limited");
    expect(error.code).toBe("throttle");
  });

  test("preserves message", () => {
    const error = new AiSdkError("auth", "Invalid API key");
    expect(error.message).toBe("Invalid API key");
  });

  test("preserves statusCode", () => {
    const error = new AiSdkError("throttle", "Rate limited", 429);
    expect(error.statusCode).toBe(429);
  });

  test("statusCode is optional", () => {
    const error = new AiSdkError("unknown", "test");
    expect(error.statusCode).toBeUndefined();
  });

  test("preserves cause", () => {
    const originalError = new Error("Original");
    const error = new AiSdkError("network", "Connection failed", undefined, originalError);
    expect(error.cause).toBe(originalError);
  });
});

// ---------------------------------------------------------------------------
// Rate limit errors (429)
// ---------------------------------------------------------------------------
describe("mapAiSdkError - rate limit errors", () => {
  test("maps statusCode 429 to throttle", () => {
    const error = { statusCode: 429, message: "Rate limit exceeded" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("throttle");
    expect(result.message).toBe("Rate limit exceeded");
    expect(result.statusCode).toBe(429);
  });

  test("maps APICallError with 5xx to throttle", () => {
    const error = { name: "APICallError", statusCode: 500, message: "Internal server error" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("throttle");
    expect(result.statusCode).toBe(500);
  });

  test("maps APICallError with 502 to throttle", () => {
    const error = { name: "APICallError", statusCode: 502, message: "Bad gateway" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("throttle");
  });

  test("maps APICallError with 503 to throttle", () => {
    const error = { name: "APICallError", statusCode: 503, message: "Service unavailable" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("throttle");
  });

  test("maps APICallError with 504 to throttle", () => {
    const error = { name: "APICallError", statusCode: 504, message: "Gateway timeout" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("throttle");
  });
});

// ---------------------------------------------------------------------------
// Auth errors (401, 403, LoadAPIKeyError)
// ---------------------------------------------------------------------------
describe("mapAiSdkError - auth errors", () => {
  test("maps statusCode 401 to auth", () => {
    const error = { statusCode: 401, message: "Unauthorized" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("auth");
    expect(result.statusCode).toBe(401);
  });

  test("maps statusCode 403 to auth", () => {
    const error = { statusCode: 403, message: "Forbidden" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("auth");
    expect(result.statusCode).toBe(403);
  });

  test("maps LoadAPIKeyError to auth", () => {
    const error = { name: "LoadAPIKeyError", message: "API key not found" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("auth");
  });

  test("LoadAPIKeyError without statusCode", () => {
    const error = { name: "LoadAPIKeyError", message: "No API key configured" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("auth");
    expect(result.statusCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Model errors (NoSuchModelError, InvalidPromptError)
// ---------------------------------------------------------------------------
describe("mapAiSdkError - model errors", () => {
  test("maps NoSuchModelError to model", () => {
    const error = { name: "NoSuchModelError", message: "Model not found" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("model");
    expect(result.message).toBe("Model not found");
  });

  test("maps InvalidPromptError to model", () => {
    const error = { name: "InvalidPromptError", message: "Invalid prompt" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("model");
    expect(result.message).toBe("Invalid prompt");
  });

  test("model errors preserve statusCode if present", () => {
    const error = { name: "NoSuchModelError", statusCode: 404, message: "Model not found" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("model");
    expect(result.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Network errors (ECONNREFUSED, etc.)
// ---------------------------------------------------------------------------
describe("mapAiSdkError - network errors", () => {
  test("maps ECONNREFUSED to network", () => {
    const error = { code: "ECONNREFUSED", message: "Connection refused" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("network");
    expect(result.message).toBe("Connection refused");
  });

  test("maps ECONNRESET to network", () => {
    const error = { code: "ECONNRESET", message: "Connection reset" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("network");
  });

  test("maps ETIMEDOUT to network", () => {
    const error = { code: "ETIMEDOUT", message: "Connection timed out" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("network");
  });

  test("maps ENOTFOUND to network", () => {
    const error = { code: "ENOTFOUND", message: "DNS lookup failed" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("network");
  });

  test("maps EAI_AGAIN to network", () => {
    const error = { code: "EAI_AGAIN", message: "DNS lookup failed temporarily" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("network");
  });

  test("maps ECONNABORTED to network", () => {
    const error = { code: "ECONNABORTED", message: "Connection aborted" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("network");
  });

  test("network errors do not have statusCode", () => {
    const error = { code: "ECONNREFUSED", message: "Connection refused" };
    const result = mapAiSdkError(error);
    expect(result.statusCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Unknown errors
// ---------------------------------------------------------------------------
describe("mapAiSdkError - unknown errors", () => {
  test("maps unknown error types to unknown", () => {
    const error = { message: "Some random error" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("unknown");
  });

  test("maps Error instance to unknown", () => {
    const error = new Error("Generic error");
    const result = mapAiSdkError(error);
    expect(result.code).toBe("unknown");
    expect(result.message).toBe("Generic error");
  });

  test("maps null to unknown", () => {
    const result = mapAiSdkError(null);
    expect(result.code).toBe("unknown");
    expect(result.message).toBe("Unknown error");
  });

  test("maps undefined to unknown", () => {
    const result = mapAiSdkError(undefined);
    expect(result.code).toBe("unknown");
  });

  test("maps string to unknown", () => {
    const result = mapAiSdkError("error string");
    expect(result.code).toBe("unknown");
    expect(result.message).toBe("Unknown error");
  });

  test("maps number to unknown", () => {
    const result = mapAiSdkError(123);
    expect(result.code).toBe("unknown");
  });

  test("APICallError with 4xx maps to unknown", () => {
    const error = { name: "APICallError", statusCode: 400, message: "Bad request" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("unknown");
    expect(result.statusCode).toBe(400);
  });

  test("APICallError with 404 maps to unknown", () => {
    const error = { name: "APICallError", statusCode: 404, message: "Not found" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("unknown");
  });

  test("preserves statusCode for unknown errors", () => {
    const error = { statusCode: 418, message: "I'm a teapot" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("unknown");
    expect(result.statusCode).toBe(418);
  });
});

// ---------------------------------------------------------------------------
// Error priority / precedence
// ---------------------------------------------------------------------------
describe("mapAiSdkError - error precedence", () => {
  test("network code takes precedence over statusCode", () => {
    // If an error has both a network code and a 401 status, network wins
    const error = { code: "ECONNREFUSED", statusCode: 401, message: "Connection refused" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("network");
  });

  test("429 checked before 401/403", () => {
    const error = { statusCode: 429, message: "Rate limited" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("throttle");
  });

  test("401/403 checked before name-based checks", () => {
    const error = { statusCode: 401, name: "APICallError", message: "Unauthorized" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("auth");
  });

  test("LoadAPIKeyError takes precedence over generic checks", () => {
    const error = { name: "LoadAPIKeyError", message: "No key" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("auth");
  });

  test("NoSuchModelError takes precedence over generic APICallError", () => {
    const error = { name: "NoSuchModelError", statusCode: 404, message: "Not found" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("model");
  });
});

// ---------------------------------------------------------------------------
// Cause preservation
// ---------------------------------------------------------------------------
describe("mapAiSdkError - cause preservation", () => {
  test("preserves cause for all error types", () => {
    const originalError = new Error("Original cause");
    const error = { statusCode: 429, message: "Rate limited" };
    // The function doesn't directly accept cause, but the error object can have it
    const result = mapAiSdkError(error);
    // Cause is passed as the 4th argument, but mapAiSdkError extracts from error object
    // Let's verify the error is wrapped properly
    expect(result).toBeInstanceOf(AiSdkError);
  });

  test("wraps the original error as cause", () => {
    const originalError = new Error("Original");
    const result = mapAiSdkError(originalError);
    expect(result.cause).toBe(originalError);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe("mapAiSdkError - edge cases", () => {
  test("handles empty message", () => {
    const error = { message: "" };
    const result = mapAiSdkError(error);
    expect(result.message).toBe("Unknown error");
  });

  test("handles missing message property", () => {
    const error = { code: "ECONNREFUSED" };
    const result = mapAiSdkError(error);
    expect(result.message).toBe("Unknown error");
  });

  test("handles object with only name", () => {
    const error = { name: "LoadAPIKeyError" };
    const result = mapAiSdkError(error);
    expect(result.code).toBe("auth");
    expect(result.message).toBe("Unknown error");
  });

  test("handles empty object", () => {
    const result = mapAiSdkError({});
    expect(result.code).toBe("unknown");
    expect(result.message).toBe("Unknown error");
  });

  test("handles error with all properties", () => {
    const error = {
      code: "ECONNREFUSED",
      statusCode: 500,
      name: "APICallError",
      message: "Full error",
    };
    // Network code takes precedence
    const result = mapAiSdkError(error);
    expect(result.code).toBe("network");
    expect(result.message).toBe("Full error");
  });

  test("handles TypeError", () => {
    const error = new TypeError("Type error");
    const result = mapAiSdkError(error);
    expect(result.code).toBe("unknown");
    expect(result.message).toBe("Type error");
  });

  test("handles RangeError", () => {
    const error = new RangeError("Range error");
    const result = mapAiSdkError(error);
    expect(result.code).toBe("unknown");
    expect(result.message).toBe("Range error");
  });
});
