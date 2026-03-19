// =============================================================================
// @obsku/framework — Plugin configuration type definitions
// Types used by plugin authors and tool implementations
// =============================================================================

import { z } from "zod";
import type { Message } from "./llm";
import type { Directive, PluginTruncationConfig } from "./truncation-config";

// Re-export truncation types for convenience
export type { Directive, PluginTruncationConfig, TruncationConfig } from "./truncation-config";

// --- Plugin Parameter Definitions ---

export interface ParamDef {
  default?: unknown;
  description?: string;
  required?: boolean;
  type: "string" | "number" | "boolean" | "object" | "array";
}

// --- Execution Options ---

export interface ExecOpts {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface FetchOpts {
  timeout?: number;
}

export interface ExecResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

// --- Logging ---

export interface Logger {
  debug(msg: string, ...args: Array<unknown>): void;
  error(msg: string, ...args: Array<unknown>): void;
  info(msg: string, ...args: Array<unknown>): void;
  warn(msg: string, ...args: Array<unknown>): void;
}

// --- Plugin Definition ---

export interface PluginDef<T extends z.ZodTypeAny = z.ZodTypeAny> {
  description: string;
  directives?: Array<Directive>;
  logger?: Logger;
  name: string;
  params: T;
  run: (
    input: z.output<T>,
    ctx: PluginCtx
  ) => Promise<PluginRunOutput> | AsyncIterable<PluginRunOutput>;
  truncation?: PluginTruncationConfig;
}

// --- Plugin Context ---

export interface PluginCtx {
  exec(cmd: string, args: Array<string>, opts?: ExecOpts): Promise<ExecResult>;
  fetch(url: string | URL, init?: RequestInit & FetchOpts): Promise<Response>;
  logger: Logger;
  signal: AbortSignal;
}

// --- Tool Results ---

/**
 * Canonical tool result shape for middleware.
 * Compatible with `ToolOutput`; middleware may also attach messages.
 */
export interface ToolResult {
  content: string;
  isError?: boolean;
  messages?: Array<Message>;
}

export interface ToolOutput {
  content: string;
  isError?: boolean;
}

// --- Tool Call Context ---

/**
 * Middleware-specific tool-call view.
 *
 * `toolInput` is already validated before middleware sees it. If middleware rewrites
 * `toolInput` before `next()`, runtime must revalidate the rewritten value before the
 * underlying tool executes.
 *
 * Nested `call()` re-enters the middleware pipeline and shares the same depth guard
 * semantics as other nested tool calls (default max depth: 5).
 */
export interface ToolCallContext extends PluginCtx {
  agentName: string;
  call(toolName: string, input: unknown): Promise<ToolResult>;
  callDepth?: number;
  iteration?: number;
  maxCallDepth?: number;
  parentToolName?: string;
  requestId?: string;
  runId?: string;
  sessionId?: string;
  toolInput: unknown;
  toolName: string;
}

// --- Tool Middleware ---

/**
 * Koa-style tool middleware.
 *
 * Middleware runs in declaration order on ingress and unwinds in reverse order.
 * Agent-level `toolMiddleware` wraps per-tool middleware, so global middleware runs
 * before local middleware on ingress and after local middleware on unwind.
 * Middleware may short-circuit by returning a `ToolResult` directly without calling
 * `next()`.
 */
export type ToolMiddleware = (
  ctx: ToolCallContext,
  next: () => Promise<ToolResult>
) => Promise<ToolResult>;

export type ToolBinding<T extends z.ZodTypeAny = z.ZodTypeAny> =
  | PluginDef<T>
  | { middleware: Array<ToolMiddleware>; tool: PluginDef<T> };

// --- Plugin Run Output ---

/**
 * Valid return values for plugin run functions.
 * - string: passed through to LLM as-is
 * - ToolResult: canonical middleware/tool result envelope
 * - ToolOutput: uses content field with optional isError flag
 * - Record/Array/primitives: auto-serialized to JSON string by the framework
 */
export type PluginRunOutput =
  | string
  | ToolResult
  | ToolOutput
  | Readonly<Record<string, unknown>>
  | ReadonlyArray<unknown>
  | boolean
  | number
  | null
  | undefined;
