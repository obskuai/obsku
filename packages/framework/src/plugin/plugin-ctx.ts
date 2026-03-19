// =============================================================================
// @obsku/framework — PluginCtx creation + default logger
// =============================================================================

import { AsyncLocalStorage } from "node:async_hooks";
import { execCmd } from "../exec";
import { DEFAULTS } from "../defaults";
import type {
  Logger,
  PluginCtx,
  ToolCallContext,
  ToolMiddleware,
  ToolResult,
} from "../types";

const hookDepthStorage =
  typeof AsyncLocalStorage === "function" ? new AsyncLocalStorage<number>() : undefined;

const DEFAULT_MAX_HOOK_DEPTH = 5;

export interface CreateToolCallContextOptions {
  agentName: string;
  baseLogger?: Logger;
  iteration?: number;
  maxDepth?: number;
  parentToolName?: string;
  requestId?: string;
  runId?: string;
  sessionId?: string;
  signal?: AbortSignal;
  toolInput: unknown;
  toolName: string;
}

export interface ToolCallRuntime {
  agentName: string;
  executeCall: ToolCallExecutor;
  iteration?: number;
  logger?: Logger;
  maxDepth?: number;
  parentToolName?: string;
  requestId?: string;
  runId?: string;
  sessionId?: string;
  signal: AbortSignal;
  toolInput: unknown;
  toolName: string;
}

export type ToolCallExecutor = (toolName: string, input: unknown) => Promise<ToolResult>;

export function createMiddlewareChain(
  ctx: ToolCallContext,
  middleware: Array<ToolMiddleware>,
  execute: () => Promise<ToolResult>
): () => Promise<ToolResult> {
  const dispatch = (index: number): Promise<ToolResult> => {
    const current = middleware[index];

    if (!current) {
      return execute();
    }

    let nextCalled = false;
    return current(ctx, async () => {
      if (nextCalled) {
        throw new Error("next() called more than once");
      }
      nextCalled = true;
      return dispatch(index + 1);
    });
  };

  return () => dispatch(0);
}

function writeToStream(stream: NodeJS.WriteStream, ...msgs: Array<unknown>): void {
  stream.write(msgs.map(String).join(" ") + "\n");
}

const isDebug = () => Boolean(process.env.OBSKU_DEBUG);

export const defaultLogger: Logger = {
  debug: (...msgs) => { if (isDebug()) writeToStream(process.stdout, ...msgs); },
  error: (...msgs) => writeToStream(process.stderr, ...msgs),
  info: (...msgs) => { if (isDebug()) writeToStream(process.stdout, ...msgs); },
  warn: (...msgs) => { if (isDebug()) writeToStream(process.stderr, ...msgs); },
};

export function createLogger(pluginName: string, baseLogger: Logger = defaultLogger): Logger {
  const prefix = `[plugin:${pluginName}]`;
  return {
    debug: (msg, ...args) => baseLogger.debug(prefix, msg, ...args),
    error: (msg, ...args) => baseLogger.error(prefix, msg, ...args),
    info: (msg, ...args) => baseLogger.info(prefix, msg, ...args),
    warn: (msg, ...args) => baseLogger.warn(prefix, msg, ...args),
  };
}

export function createPluginCtx(
  pluginName: string,
  signal: AbortSignal,
  baseLogger: Logger = defaultLogger
): PluginCtx {
  return {
    exec: (cmd, args, opts) => execCmd(cmd, args, opts, signal),
    fetch: async (url, init) => {
      const timeout = init?.timeout ?? DEFAULTS.toolTimeout;
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), timeout);

      if (signal.aborted) {
        clearTimeout(timeoutId);
        throw new Error(`fetch aborted: plugin cancelled`);
      }

      const onParentAbort = () => timeoutController.abort();
      signal.addEventListener("abort", onParentAbort, { once: true });

      try {
        const { timeout: _, ...fetchInit } = init ?? {};
        return await fetch(url, { ...fetchInit, signal: timeoutController.signal });
      } finally {
        clearTimeout(timeoutId);
        signal.removeEventListener("abort", onParentAbort);
      }
    },
    logger: createLogger(pluginName, baseLogger),
    signal,
  };
}


export function createToolCallContext(
  runtime: ToolCallRuntime,
  options: Partial<CreateToolCallContextOptions> = {}
): ToolCallContext {
  const signal = options.signal ?? runtime.signal;
  const toolName = options.toolName ?? runtime.toolName;
  const pluginCtx = createPluginCtx(
    toolName,
    signal,
    options.baseLogger ?? runtime.logger ?? defaultLogger
  );
  const currentDepth = hookDepthStorage?.getStore() ?? 0;
  const maxDepth = options.maxDepth ?? runtime.maxDepth ?? DEFAULT_MAX_HOOK_DEPTH;

  return {
    ...pluginCtx,
    agentName: options.agentName ?? runtime.agentName,
    call: async (toolName, input) => {
      if (currentDepth >= maxDepth) {
        throw new Error(`Tool call depth exceeded (max: ${maxDepth})`);
      }

      const runCall = async (): Promise<ToolResult> => runtime.executeCall(toolName, input);

      if (!hookDepthStorage) {
        return runCall();
      }

      return hookDepthStorage.run(currentDepth + 1, runCall);
    },
    callDepth: currentDepth,
    iteration: options.iteration ?? runtime.iteration,
    maxCallDepth: maxDepth,
    parentToolName: options.parentToolName ?? runtime.parentToolName,
    requestId: options.requestId ?? runtime.requestId,
    runId: options.runId ?? runtime.runId,
    sessionId: options.sessionId ?? runtime.sessionId,
    toolInput: options.toolInput ?? runtime.toolInput,
    toolName,
  };
}
