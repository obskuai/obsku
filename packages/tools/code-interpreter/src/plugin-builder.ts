/**
 * Shared code interpreter plugin builder.
 *
 * Extracts the common params schema and run logic used by both the local
 * and AgentCore code interpreter wrappers, eliminating duplication.
 */

import { formatError, plugin } from "@obsku/framework";

import { z } from "zod";
import { serializeExecutionResult } from "./serialization";
import type { ExecutionOptions, ExecutionResult } from "./types";

// ---------------------------------------------------------------------------
// Public inputFiles boundary types
// ---------------------------------------------------------------------------

/**
 * Accepted shapes for a single `inputFiles` entry at the **public plugin boundary**.
 *
 * | Type         | Notes                                                          |
 * |--------------|----------------------------------------------------------------|
 * | `string`     | Plain text; staged to disk as UTF-8.                           |
 * | `Uint8Array` | Raw bytes; `Buffer` is accepted because it extends Uint8Array. |
 *
 * **Explicitly rejected at the public boundary:**
 * - `{ type: "Buffer", data: [...] }` — convert to `Buffer`/`Uint8Array` first.
 * - Number arrays — use `new Uint8Array([...])` instead.
 * - `null`, `undefined`, or any other object shape.
 *
 * @remarks
 * Internally the executor receives `Map<string, string | Uint8Array>`
 * (see `ExecutionOptions`). The plugin converts the incoming record to that
 * Map before dispatch; this internal step is kept flexible so future executor
 * shapes can be added without altering the public schema.
 */
export type InputFilesValue = string | Uint8Array;

/**
 * Public `inputFiles` record accepted by the code interpreter plugin.
 * Keys are filenames; values must satisfy {@link InputFilesValue}.
 */
export type InputFilesRecord = Record<string, InputFilesValue>;

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

export const isInputFilesValue = (value: unknown): value is InputFilesValue =>
  typeof value === "string" ||
  (typeof value === "object" &&
    value !== null &&
    Object.prototype.isPrototypeOf.call(Uint8Array.prototype, value as object));

const isBinaryInputFilesValue = (value: unknown): value is Uint8Array =>
  typeof value !== "string" && isInputFilesValue(value);

const inputFilesBinaryValue: z.ZodType<Uint8Array> = z
  .unknown()
  .refine(isBinaryInputFilesValue, { message: "inputFiles values must be string or Uint8Array" });

const inputFilesValue: z.ZodType<InputFilesValue> = z.union([z.string(), inputFilesBinaryValue]);

/**
 * Shared Zod parameter schema for code interpreter plugins.
 * Used by both local and AgentCore wrappers to ensure identical interface.
 *
 * @remarks
 * The `inputFiles` field accepts an {@link InputFilesRecord}: a plain object
 * whose values are either `string` or `Uint8Array` (including `Buffer`).
 * Plain-object buffer serializations (`{ type: "Buffer", data: [...] }`) and
 * raw number arrays are **not** valid — callers must materialise them into a
 * real `Buffer` or `Uint8Array` before passing.
 */
export const codeInterpreterParams = z.object({
  code: z.string().describe("Code to execute"),
  inputFiles: z
    .record(z.string(), inputFilesValue)
    .optional()
    .describe(
      "Optional input files (filename -> content). Values must be string or Uint8Array (Buffer accepted)."
    ),
  language: z.enum(["python", "javascript", "typescript"]).describe("Programming language"),
  sessionId: z.string().optional().describe("Optional session ID for stateful execution"),
  timeoutMs: z.number().optional().describe("Optional timeout in milliseconds"),
});

/** Minimal executor interface required by the shared plugin builder. */
interface MinimalExecutor {
  execute(opts: ExecutionOptions): Promise<ExecutionResult>;
}

/** Minimal session manager interface required by the shared plugin builder. */
interface MinimalSessionManager {
  execute(options: ExecutionOptions & { sessionId: string }): Promise<ExecutionResult>;
}

/**
 * Options for building a code interpreter plugin.
 */
export interface CodeInterpreterPluginOptions {
  /** Plugin description shown to the LLM. */
  description: string;
  /** Code executor for stateless runs. */
  executor: MinimalExecutor;
  /** Security warning injected into every invocation. */
  securityWarning: string;
  /** Session manager for stateful runs. */
  sessionManager: MinimalSessionManager;
}

/**
 * Shared plugin factory for code interpreter tools.
 * Both local and AgentCore wrappers delegate here to avoid duplication.
 */
export const buildCodeInterpreterPlugin = (opts: CodeInterpreterPluginOptions) =>
  plugin({
    description: opts.description,
    directives: [
      {
        inject: opts.securityWarning,
        match: () => true,
        name: "security-warning",
      },
    ],
    name: "code_interpreter",
    params: codeInterpreterParams,
    run: async (input) => {
      try {
        const { code, inputFiles, language, sessionId, timeoutMs } = input;

        // Convert the public InputFilesRecord to the internal Map used by executors.
        // Object.entries() preserves all valid InputFilesValue shapes without
        // coercion; internal executor changes only need to touch ExecutionOptions.
        const inputFileMap = inputFiles
          ? new Map<string, string | Uint8Array>(Object.entries(inputFiles as InputFilesRecord))
          : undefined;

        const result = sessionId
          ? await opts.sessionManager.execute({
              code,
              inputFiles: inputFileMap,
              language,
              sessionId,
              timeoutMs,
            })
          : await opts.executor.execute({
              code,
              inputFiles: inputFileMap,
              language,
              timeoutMs,
            });

        return serializeExecutionResult(result);
      } catch (error: unknown) {
        const message = formatError(error);
        return { content: message, isError: true };
      }
    },
  });
