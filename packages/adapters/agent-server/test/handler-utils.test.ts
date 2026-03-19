// Unit tests for handler-utils.ts utility functions
// Tests createHandlerErrorResponse, getHttpErrorMessage, createExecutionContext,
// executeWithContext, and createJsonRpcErrorResponse

import { describe, expect, it } from "bun:test";
import type { AgentEvent, ConversationMessage, LLMProvider } from "@obsku/framework";
import { HTTP_STATUS, JSONRPC_VERSION } from "../src/constants";
import {
  createExecutionContext,
  createHandlerErrorResponse,
  createJsonRpcErrorResponse,
  errorToHttpStatus,
  executeWithContext,
  getHttpErrorMessage,
} from "../src/handler-utils";

// ---------------------------------------------------------------------------
// Stub provider for tests
// ---------------------------------------------------------------------------
const stubProvider: LLMProvider = {
  chat: async () => ({
    content: [{ text: "stub", type: "text" }],
    stopReason: "end_turn",
    usage: { inputTokens: 0, outputTokens: 0 },
  }),
  chatStream: async function* () {},
  contextWindowSize: 1000,
};

// ---------------------------------------------------------------------------
// createHandlerErrorResponse
// ---------------------------------------------------------------------------
describe("createHandlerErrorResponse", () => {
  it("returns Response with default 400 status", async () => {
    const response = createHandlerErrorResponse("Test error");
    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Test error");
  });

  it("returns Response with custom status when provided", async () => {
    const response = createHandlerErrorResponse("Server error", { status: 500 });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Server error");
  });

  it("returns Response with 404 status", async () => {
    const response = createHandlerErrorResponse("Not found", { status: HTTP_STATUS.NOT_FOUND });
    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it("returns Response with 413 status", async () => {
    const response = createHandlerErrorResponse("Payload too large", {
      status: HTTP_STATUS.PAYLOAD_TOO_LARGE,
    });
    expect(response.status).toBe(HTTP_STATUS.PAYLOAD_TOO_LARGE);
  });

  it("handles empty message", async () => {
    const response = createHandlerErrorResponse("");
    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("");
  });
});

// ---------------------------------------------------------------------------
// getHttpErrorMessage
// ---------------------------------------------------------------------------
describe("getHttpErrorMessage", () => {
  it("extracts message from Error instance", () => {
    const error = new Error("Something went wrong");
    expect(getHttpErrorMessage(error)).toBe("Something went wrong");
  });

  it("returns fallback for non-Error values", () => {
    expect(getHttpErrorMessage("string error")).toBe("Unknown error");
    expect(getHttpErrorMessage(123)).toBe("Unknown error");
    expect(getHttpErrorMessage(null)).toBe("Unknown error");
    expect(getHttpErrorMessage(undefined)).toBe("Unknown error");
    expect(getHttpErrorMessage({ foo: "bar" })).toBe("Unknown error");
  });

  it("returns custom fallback when provided", () => {
    expect(getHttpErrorMessage("string error", "Custom fallback")).toBe("Custom fallback");
    expect(getHttpErrorMessage(null, "Custom fallback")).toBe("Custom fallback");
    expect(getHttpErrorMessage(undefined, "Custom fallback")).toBe("Custom fallback");
  });

  it("handles TypeError", () => {
    const error = new TypeError("Type error");
    expect(getHttpErrorMessage(error)).toBe("Type error");
  });

  it("handles SyntaxError", () => {
    const error = new SyntaxError("Syntax error");
    expect(getHttpErrorMessage(error)).toBe("Syntax error");
  });

  it("handles custom error classes", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }
    const error = new CustomError("Custom error message");
    expect(getHttpErrorMessage(error)).toBe("Custom error message");
  });
});

// ---------------------------------------------------------------------------
// createExecutionContext
// ---------------------------------------------------------------------------
describe("createExecutionContext", () => {
  it("creates context with required fields only", () => {
    const ctx = createExecutionContext({
      input: "test input",
      provider: stubProvider,
    });

    expect(ctx.input).toBe("test input");
    expect(ctx.provider).toBe(stubProvider);
    expect(ctx.options).toBeUndefined();
  });

  it("creates context with messages", () => {
    const messages: Array<ConversationMessage> = [
      { content: "Hello", role: "user" },
      { content: "Hi there", role: "assistant" },
    ];

    const ctx = createExecutionContext({
      input: "current",
      messages,
      provider: stubProvider,
    });

    expect(ctx.input).toBe("current");
    expect(ctx.options?.messages).toEqual(messages);
    expect(ctx.provider).toBe(stubProvider);
  });

  it("creates context with onEvent callback", () => {
    const events: Array<AgentEvent> = [];
    const onEvent = (event: AgentEvent) => events.push(event);

    const ctx = createExecutionContext({
      input: "test",
      onEvent,
      provider: stubProvider,
    });

    expect(ctx.options?.onEvent).toBe(onEvent);
  });

  it("creates context with both messages and onEvent", () => {
    const messages: Array<ConversationMessage> = [{ content: "prev", role: "user" }];
    const events: Array<AgentEvent> = [];
    const onEvent = (event: AgentEvent) => events.push(event);

    const ctx = createExecutionContext({
      input: "current",
      messages,
      onEvent,
      provider: stubProvider,
    });

    expect(ctx.options?.messages).toEqual(messages);
    expect(ctx.options?.onEvent).toBe(onEvent);
  });

  it("sets options to undefined when neither messages nor onEvent provided", () => {
    const ctx = createExecutionContext({
      input: "test",
      provider: stubProvider,
    });

    expect(ctx.options).toBeUndefined();
  });

  it("sets options object when only messages provided", () => {
    const ctx = createExecutionContext({
      input: "test",
      messages: [],
      provider: stubProvider,
    });

    expect(ctx.options).toBeDefined();
    expect(ctx.options?.messages).toEqual([]);
    expect(ctx.options?.onEvent).toBeUndefined();
  });

  it("sets options object when only onEvent provided", () => {
    const ctx = createExecutionContext({
      input: "test",
      onEvent: () => {},
      provider: stubProvider,
    });

    expect(ctx.options).toBeDefined();
    expect(ctx.options?.messages).toBeUndefined();
    expect(ctx.options?.onEvent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// executeWithContext
// ---------------------------------------------------------------------------
describe("executeWithContext", () => {
  it("executes agent with context input and provider", async () => {
    let capturedInput: string | undefined;
    let capturedProvider: LLMProvider | undefined;

    const mockAgent = {
      name: "test-agent",
      run: async (input: string, provider: LLMProvider) => {
        capturedInput = input;
        capturedProvider = provider;
        return "result";
      },
    };

    const ctx = createExecutionContext({
      input: "test prompt",
      provider: stubProvider,
    });

    const result = await executeWithContext(mockAgent, ctx);
    expect(result).toBe("result");
    expect(capturedInput).toBe("test prompt");
    expect(capturedProvider).toBe(stubProvider);
  });

  it("passes options to agent run", async () => {
    let capturedOptions:
      | { messages?: Array<ConversationMessage>; onEvent?: (event: AgentEvent) => void }
      | undefined;

    const mockAgent = {
      name: "test-agent",
      run: async (_input: string, _provider: LLMProvider, options?: typeof capturedOptions) => {
        capturedOptions = options;
        return "done";
      },
    };

    const messages: Array<ConversationMessage> = [{ content: "prev", role: "user" }];
    const ctx = createExecutionContext({
      input: "current",
      messages,
      provider: stubProvider,
    });

    await executeWithContext(mockAgent, ctx);
    expect(capturedOptions?.messages).toEqual(messages);
  });

  it("returns agent result directly", async () => {
    const mockAgent = {
      name: "test-agent",
      run: async () => "agent output",
    };

    const ctx = createExecutionContext({
      input: "test",
      provider: stubProvider,
    });

    const result = await executeWithContext(mockAgent, ctx);
    expect(result).toBe("agent output");
  });
});

// ---------------------------------------------------------------------------
// createJsonRpcErrorResponse
// ---------------------------------------------------------------------------
describe("createJsonRpcErrorResponse", () => {
  it("creates valid JSON-RPC error response with string id", () => {
    const response = createJsonRpcErrorResponse(-32_600, "Invalid Request", "req-123");

    expect(response.jsonrpc).toBe(JSONRPC_VERSION);
    expect(response.id).toBe("req-123");
    expect(response.error.code).toBe(-32_600);
    expect(response.error.message).toBe("Invalid Request");
  });

  it("creates valid JSON-RPC error response with numeric id", () => {
    const response = createJsonRpcErrorResponse(-32_601, "Method not found", 42);

    expect(response.jsonrpc).toBe(JSONRPC_VERSION);
    expect(response.id).toBe(42);
    expect(response.error.code).toBe(-32_601);
    expect(response.error.message).toBe("Method not found");
  });

  it("creates valid JSON-RPC error response with null id", () => {
    const response = createJsonRpcErrorResponse(-32_700, "Parse error", null);

    expect(response.jsonrpc).toBe(JSONRPC_VERSION);
    expect(response.id).toBeNull();
    expect(response.error.code).toBe(-32_700);
    expect(response.error.message).toBe("Parse error");
  });

  it("uses standard JSON-RPC error codes correctly", () => {
    // -32700: Parse error
    const parseError = createJsonRpcErrorResponse(-32_700, "Parse error", null);
    expect(parseError.error.code).toBe(-32_700);

    // -32600: Invalid Request
    const invalidRequest = createJsonRpcErrorResponse(-32_600, "Invalid Request", "1");
    expect(invalidRequest.error.code).toBe(-32_600);

    // -32601: Method not found
    const methodNotFound = createJsonRpcErrorResponse(-32_601, "Method not found", "2");
    expect(methodNotFound.error.code).toBe(-32_601);

    // -32602: Invalid params
    const invalidParams = createJsonRpcErrorResponse(-32_602, "Invalid params", "3");
    expect(invalidParams.error.code).toBe(-32_602);

    // -32603: Internal error
    const internalError = createJsonRpcErrorResponse(-32_603, "Internal error", "4");
    expect(internalError.error.code).toBe(-32_603);
  });

  it("supports custom error codes", () => {
    const customError = createJsonRpcErrorResponse(
      -32_001,
      "Custom application error",
      "custom-id"
    );

    expect(customError.error.code).toBe(-32_001);
    expect(customError.error.message).toBe("Custom application error");
    expect(customError.id).toBe("custom-id");
  });

  it("response structure matches JSON-RPC 2.0 spec", () => {
    const response = createJsonRpcErrorResponse(-32_603, "Internal error", "test-id");

    // Verify structure: { jsonrpc: "2.0", error: { code, message }, id }
    expect(response).toHaveProperty("jsonrpc");
    expect(response).toHaveProperty("error");
    expect(response).toHaveProperty("id");
    expect(response.error).toHaveProperty("code");
    expect(response.error).toHaveProperty("message");
    expect(Object.keys(response).sort()).toEqual(["error", "id", "jsonrpc"]);
    expect(Object.keys(response.error).sort()).toEqual(["code", "message"]);
  });
});

// ---------------------------------------------------------------------------
// errorToHttpStatus
// ---------------------------------------------------------------------------
describe("errorToHttpStatus", () => {
  it("returns 500 for null/undefined errors", () => {
    expect(errorToHttpStatus(null)).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    expect(errorToHttpStatus(undefined)).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
  });

  it("returns 500 for primitive errors", () => {
    expect(errorToHttpStatus("string error")).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    expect(errorToHttpStatus(123)).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
  });

  // Auth errors → 401
  describe("auth errors", () => {
    it("returns 401 for httpStatusCode 401", () => {
      const error = { $metadata: { httpStatusCode: 401 } };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it("returns 401 for httpStatusCode 403", () => {
      const error = { $metadata: { httpStatusCode: 403 } };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it("returns 401 for statusCode 401", () => {
      const error = { statusCode: 401 };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it("returns 401 for status 401", () => {
      const error = { status: 401 };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it("returns 401 for error name Unauthorized", () => {
      const error = { name: "Unauthorized" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it("returns 401 for error code AccessDenied", () => {
      const error = { code: "AccessDenied" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it("returns 401 for error message InvalidApiKey", () => {
      const error = { message: "InvalidApiKey" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it("returns 401 for AWS SignatureDoesNotMatch", () => {
      const error = { code: "SignatureDoesNotMatch" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it("returns 401 for AWS InvalidAccessKeyId", () => {
      const error = { code: "InvalidAccessKeyId" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.UNAUTHORIZED);
    });
  });

  // Network errors → 503
  describe("network errors", () => {
    it("returns 503 for ECONNREFUSED", () => {
      const error = { code: "ECONNREFUSED" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    });

    it("returns 503 for ECONNRESET", () => {
      const error = { code: "ECONNRESET" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    });

    it("returns 503 for ETIMEDOUT", () => {
      const error = { code: "ETIMEDOUT" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    });

    it("returns 503 for ENOTFOUND", () => {
      const error = { code: "ENOTFOUND" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    });

    it("returns 503 for NetworkError name", () => {
      const error = { name: "NetworkError" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    });

    it("returns 503 for TimeoutError name", () => {
      const error = { name: "TimeoutError" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    });
  });

  // Config errors → 400
  describe("config/validation errors", () => {
    it("returns 400 for InvalidConfiguration name", () => {
      const error = { name: "InvalidConfiguration" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.BAD_REQUEST);
    });

    it("returns 400 for ValidationError name", () => {
      const error = { name: "ValidationError" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.BAD_REQUEST);
    });

    it("returns 400 for InvalidParameter code", () => {
      const error = { code: "InvalidParameter" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.BAD_REQUEST);
    });

    it("returns 400 for InvalidModel code", () => {
      const error = { code: "InvalidModel" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.BAD_REQUEST);
    });

    it("returns 400 for ModelNotFound message", () => {
      const error = { message: "ModelNotFound" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.BAD_REQUEST);
    });
  });

  // Other → 500
  describe("unknown errors", () => {
    it("returns 500 for unknown error name", () => {
      const error = { name: "SomeRandomError" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    });

    it("returns 500 for unknown error code", () => {
      const error = { code: "UNKNOWN_CODE" };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    });

    it("returns 500 for generic Error instance", () => {
      const error = new Error("Something went wrong");
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    });

    it("returns 500 for httpStatusCode 500", () => {
      const error = { $metadata: { httpStatusCode: 500 } };
      expect(errorToHttpStatus(error)).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    });
  });
});
