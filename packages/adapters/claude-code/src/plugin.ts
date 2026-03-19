// @obsku/adapter-claude-code — Plugin factory
// Creates a plugin definition that can be used with obsku's plugin() factory

import type { PluginCtx } from "@obsku/framework";
import { z } from "zod";
import { buildClaudeInvocationConfig } from "./config";
import { runClaude } from "./runner";
import type { ClaudeCodePluginConfig, ClaudeCodePluginParams } from "./types";

/**
 * Zod schema for Claude Code plugin parameters.
 */
export const ClaudeCodePluginParamsSchema = z.object({
  cwd: z.string().optional().describe("Working directory for Claude Code"),
  mode: z.enum(["json", "text"]).optional().describe("Output mode: text or structured json"),
  prompt: z.string().describe("The prompt/instruction to send to Claude Code"),
  schema: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("JSON schema for structured output (json mode only)"),
});

/**
 * Creates a Claude Code plugin definition that integrates with obsku's agent framework.
 * Use with the `plugin()` factory from @obsku/framework:
 *
 * @example
 * ```typescript
 * import { plugin } from "@obsku/framework";
 * import { createClaudeCodePlugin } from "@obsku/adapter-claude-code";
 *
 * const claudeCode = plugin(createClaudeCodePlugin());
 *
 * const agent = createAgent({
 *   name: "coder",
 *   tools: [claudeCode],
 * });
 * ```
 *
 * @param config - Optional configuration for the adapter
 * @returns A PluginDef that can be passed to the plugin() factory
 */
export function createClaudeCodePlugin(config: ClaudeCodePluginConfig = {}) {
  return {
    description:
      "Execute tasks using Claude Code CLI. Supports both text and structured JSON output modes.",
    name: "claude_code" as const,
    params: ClaudeCodePluginParamsSchema,
    run: async (params: ClaudeCodePluginParams, ctx: PluginCtx) => {
      const invocationConfig = buildClaudeInvocationConfig(config, { cwd: params.cwd });

      const result = await runClaude(params, {
        cliArgs: invocationConfig.cliArgs,
        cwd: params.cwd ?? config.cwd,
        signal: ctx.signal,
      });

      // Return result directly - framework handles serialization
      return result;
    },
  };
}
