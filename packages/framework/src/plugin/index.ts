// =============================================================================
// @obsku/framework — plugin() factory + public plugin module API
// =============================================================================

import { Effect } from "effect";
import { z } from "zod";
import { ExecTimeoutError } from "../exec";
import type { Directive, ParamDef, PluginDef } from "../types";
import { createPluginCtx, defaultLogger } from "./plugin-ctx";
import { executePluginRun, PluginExecError } from "./runtime-wrapping";
import { convertZodToParamDef } from "./schema-conversion";

export { paramDefToZod } from "./param-validation";
export type { PluginExecutionResult } from "./runtime-wrapping";
export { ParamValidationError, PluginExecError } from "./runtime-wrapping";
// Re-exports from sub-modules — all previously top-level exports preserved
export { convertZodToParamDef, isZodSchema } from "./schema-conversion";
export { ExecTimeoutError };

// --- Internal Plugin representation ---

export interface InternalPlugin {
  readonly description: string;
  readonly directives?: Array<Directive>;
  /** Runs the plugin as an Effect; Promise → Effect conversion + timeout + signal */
  readonly execute: (
    input: Record<string, unknown>,
    onProgress?: (chunk: unknown) => void
  ) => Effect.Effect<unknown, PluginExecError>;
  readonly name: string;
  readonly params: Record<string, ParamDef>;
}

// --- plugin() factory ---

/**
 * Create a plugin from a definition.
 * Public API: takes PluginDef (Promise-based), returns InternalPlugin (Effect-based internally).
 */
export function plugin<T extends z.ZodType>(def: PluginDef<T>): InternalPlugin {
  const params = convertZodToParamDef(def.params);

  return {
    description: def.description,
    directives: def.directives,
    execute: (input, onProgress) =>
      Effect.gen(function* () {
        const parseResult = (def.params as z.ZodType).safeParse(input);
        if (!parseResult.success) {
          return yield* Effect.fail(new PluginExecError(def.name, parseResult.error));
        }
        const validatedInput = parseResult.data;

        const controller = new AbortController();
        yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));

        const baseLogger = def.logger ?? defaultLogger;
        const ctx = createPluginCtx(def.name, controller.signal, baseLogger);
        const runResult = def.run(validatedInput as z.output<T>, ctx);

        return yield* executePluginRun(runResult, def.name, onProgress);
      }).pipe(Effect.scoped),
    name: def.name,
    params,
  };
}
