import type { AgentEvent, ConversationMessage, LLMProvider } from "@obsku/framework";
import { toErrorRecord, NETWORK_ERROR_CODES } from "@obsku/framework";
import { HTTP_STATUS, JSONRPC_VERSION } from "./constants";
import {
  createErrorResponse,
  createServerConfig,
  createSSEStream,
  parseJsonBody,
  resolveProvider,
} from "./base-handler";
import type { AgentLike, ServeOptions } from "./shared";

// Re-export for consumers that import createServerConfig via handler-utils
export { createServerConfig } from "./base-handler";

export function getHttpErrorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

export interface HandlerResponseOptions {
  status?: number;
}

export interface ParseJsonRequestOptions extends HandlerResponseOptions {
  invalidJsonMessage?: string;
  tag?: string;
  writeErr?: (msg: string) => void;
}

export type ParseJsonRequestResult<T> = { body: T; ok: true } | { ok: false; response: Response };

export interface ResolveRequestProviderOptions extends HandlerResponseOptions {
  defaultProvider: LLMProvider;
  failureMessage?: string;
  model?: string;
  providerFactory?: ServeOptions["providerFactory"];
  tag?: string;
  writeErr?: (msg: string) => void;
}

export type ResolveRequestProviderResult =
  | { ok: true; provider: LLMProvider }
  | { ok: false; response: Response };

export interface ExecutionContext {
  input: string;
  options?: {
    messages?: Array<ConversationMessage>;
    onEvent?: (event: AgentEvent) => void;
  };
  provider: LLMProvider;
}

export interface CreateExecutionContextOptions {
  input: string;
  messages?: Array<ConversationMessage>;
  onEvent?: (event: AgentEvent) => void;
  provider: LLMProvider;
}

export function createHandlerErrorResponse(
  message: string,
  options?: HandlerResponseOptions
): Response {
  return createErrorResponse(message, options?.status ?? HTTP_STATUS.BAD_REQUEST);
}

/** Auth-related error codes/names */
const AUTH_ERROR_INDICATORS = new Set([
  "Unauthorized",
  "Unauthenticated",
  "InvalidApiKey",
  "AccessDenied",
  "SignatureDoesNotMatch",
  "InvalidAccessKeyId",
  "MissingAuthenticationToken",
  "ExpiredToken",
]);

/** Config/validation error codes/names */
const CONFIG_ERROR_INDICATORS = new Set([
  "InvalidConfiguration",
  "ValidationError",
  "InvalidParameter",
  "InvalidModel",
  "ModelNotFound",
]);

/**
 * Map provider/factory errors to appropriate HTTP status codes.
 * - Auth errors → 401
 * - Network errors → 503
 * - Config errors → 400
 * - Other → 500
 */
export function errorToHttpStatus(error: unknown): number {
  const record = toErrorRecord(error);
  if (!record) return HTTP_STATUS.INTERNAL_SERVER_ERROR;

  const name = typeof record["name"] === "string" ? record["name"] : undefined;
  const code = typeof record["code"] === "string" ? record["code"] : undefined;
  const message = typeof record["message"] === "string" ? record["message"] : undefined;

  // Check HTTP status code in error metadata
  const metadata = toErrorRecord(record["$metadata"]);
  const httpStatus =
    typeof metadata?.["httpStatusCode"] === "number"
      ? metadata["httpStatusCode"]
      : typeof record["statusCode"] === "number"
        ? record["statusCode"]
        : typeof record["status"] === "number"
          ? record["status"]
          : undefined;

  // Auth errors → 401
  if (httpStatus === 401 || httpStatus === 403) return HTTP_STATUS.UNAUTHORIZED;
  if (name && AUTH_ERROR_INDICATORS.has(name)) return HTTP_STATUS.UNAUTHORIZED;
  if (code && AUTH_ERROR_INDICATORS.has(code)) return HTTP_STATUS.UNAUTHORIZED;
  if (message && AUTH_ERROR_INDICATORS.has(message)) return HTTP_STATUS.UNAUTHORIZED;

  // Network errors → 503
  if (code && NETWORK_ERROR_CODES.has(code)) return HTTP_STATUS.SERVICE_UNAVAILABLE;
  if (name === "NetworkError" || name === "TimeoutError") return HTTP_STATUS.SERVICE_UNAVAILABLE;

  // Config/validation errors → 400
  if (name && CONFIG_ERROR_INDICATORS.has(name)) return HTTP_STATUS.BAD_REQUEST;
  if (code && CONFIG_ERROR_INDICATORS.has(code)) return HTTP_STATUS.BAD_REQUEST;
  if (message && CONFIG_ERROR_INDICATORS.has(message)) return HTTP_STATUS.BAD_REQUEST;

  // Default → 500
  return HTTP_STATUS.INTERNAL_SERVER_ERROR;
}

export async function parseJsonRequest<T = unknown>(
  req: Request,
  options?: ParseJsonRequestOptions
): Promise<ParseJsonRequestResult<T>> {
  try {
    const body = await parseJsonBody(req, options?.writeErr, options?.tag);
    return { body: body as T, ok: true };
  } catch (error: unknown) {
    // Error already logged by parseJsonBody; return sanitized user-facing response
    const isPayloadTooLarge = error instanceof Error && error.message === "PAYLOAD_TOO_LARGE";
    const status = isPayloadTooLarge
      ? HTTP_STATUS.PAYLOAD_TOO_LARGE
      : (options?.status ?? HTTP_STATUS.BAD_REQUEST);
    const message = isPayloadTooLarge
      ? "Request body too large"
      : (options?.invalidJsonMessage ?? "Invalid JSON");
    return {
      ok: false,
      response: createHandlerErrorResponse(message, { status }),
    };
  }
}

export async function resolveRequestProvider(
  options: ResolveRequestProviderOptions
): Promise<ResolveRequestProviderResult> {
  try {
    const provider = await resolveProvider(
      options.defaultProvider,
      options.model,
      options.providerFactory,
      options.writeErr,
      options.tag
    );

    return { ok: true, provider };
  } catch (error: unknown) {
    // Error already logged by resolveProvider; return sanitized user-facing response
    const status = errorToHttpStatus(error);
    return {
      ok: false,
      response: createHandlerErrorResponse(options.failureMessage ?? "Provider creation failed", {
        status: options.status ?? status,
      }),
    };
  }
}

export function createExecutionContext(options: CreateExecutionContextOptions): ExecutionContext {
  const runOptions =
    options.messages !== undefined || options.onEvent !== undefined
      ? {
          messages: options.messages,
          onEvent: options.onEvent,
        }
      : undefined;

  return {
    input: options.input,
    options: runOptions,
    provider: options.provider,
  };
}

export function executeWithContext(agent: AgentLike, context: ExecutionContext): Promise<string> {
  return agent.run(context.input, context.provider, context.options);
}

export interface RunAgentInSSEOptions {
  agent: AgentLike;
  input: string;
  isAborted: () => boolean;
  messages?: Array<ConversationMessage>;
  onComplete?: () => void;
  onError: (error: unknown) => void;
  onEvent: (event: AgentEvent) => void;
  onPreRun?: () => void;
  provider: LLMProvider;
}

export async function runAgentInSSE(options: RunAgentInSSEOptions): Promise<void> {
  options.onPreRun?.();
  try {
    const ctx = createExecutionContext({
      input: options.input,
      messages: options.messages,
      onEvent: options.onEvent,
      provider: options.provider,
    });
    await executeWithContext(options.agent, ctx);
    if (!options.isAborted()) options.onComplete?.();
  } catch (error: unknown) {
    if (!options.isAborted()) options.onError(error);
  }
}

// ---------------------------------------------------------------------------
// Shared run/stream orchestration
// ---------------------------------------------------------------------------

/** Context supplied to the protocol-specific callback factory inside runAgentStream. */
export interface SSEStreamContext {
  close: () => void;
  isAborted: () => boolean;
  send: (data: string) => void;
}

export interface RunAgentStreamOptions {
  agent: AgentLike;
  /**
   * Factory called once the SSE stream is open.  Receives the raw stream
   * primitives and returns protocol-specific callbacks.  All envelope/codec
   * logic lives here; the orchestration loop is shared.
   */
  buildCallbacks: (ctx: SSEStreamContext) => {
    onComplete?: () => void;
    onError: (error: unknown) => void;
    onEvent: (event: AgentEvent) => void;
    onPreRun?: () => void;
  };
  input: string;
  messages?: Array<ConversationMessage>;
  provider: LLMProvider;
  signal: AbortSignal;
  writeErr: (msg: string) => void;
}

/**
 * Shared SSE orchestration: opens the stream, builds protocol callbacks, then
 * runs the agent.  Protocol-specific envelope/codec stays in `buildCallbacks`.
 */
export function runAgentStream(options: RunAgentStreamOptions): Response {
  const { agent, buildCallbacks, input, messages, provider, signal, writeErr } = options;
  return createSSEStream(
    signal,
    async (send, isAborted, close) => {
      const callbacks = buildCallbacks({ close, isAborted, send });
      await runAgentInSSE({
        agent,
        input,
        isAborted,
        messages,
        onComplete: callbacks.onComplete,
        onError: callbacks.onError,
        onEvent: callbacks.onEvent,
        onPreRun: callbacks.onPreRun,
        provider,
      });
    },
    writeErr
  );
}

// ---------------------------------------------------------------------------
// JSON-RPC error response helper
// ---------------------------------------------------------------------------

export interface JsonRpcErrorResponse {
  error: { code: number; message: string };
  id: string | number | null;
  jsonrpc: typeof JSONRPC_VERSION;
}

export function createJsonRpcErrorResponse(
  code: number,
  message: string,
  id: string | number | null
): JsonRpcErrorResponse {
  return {
    error: { code, message },
    id,
    jsonrpc: JSONRPC_VERSION,
  };
}
