// =============================================================================
// @obsku/framework — asPlugin() helper: wrap agent as PluginDef
// =============================================================================

import { AsyncLocalStorage } from "node:async_hooks";
import { AgentRecursionError, AgentValidationError } from "./agent/errors";
import type { LLMProvider, PluginDef } from "./types";
import { z } from "zod";

// Guard: AsyncLocalStorage may be undefined in bundled environments
// where bun build shims node:async_hooks as an empty object.
const depthStorage =
  typeof AsyncLocalStorage === "function" ? new AsyncLocalStorage<number>() : undefined;

/**
 * Agent interface that can be wrapped as a plugin.
 * Matches the return type of agent() factory.
 */
export interface AgentLike {
  name: string;
  run: (input: string, provider: LLMProvider) => Promise<string>;
}

/**
 * Wrap an agent as a PluginDef, enabling agents to call other agents as tools.
 *
 * The plugin exposes a single `task` parameter (string) that is passed to the agent.
 * Max depth protection prevents infinite recursion (default: 5 levels).
 *
 * @param agent - The agent to wrap (must have name and run method)
 * @param provider - LLM provider to pass to agent.run()
 * @param options - Optional configuration (maxDepth)
 * @returns PluginDef that can be used in agent.tools array
 *
 * @example
 * ```typescript
 * const subAgent = agent({ name: "researcher", prompt: "...", tools: [] });
 * const mainAgent = agent({
 *   name: "main",
 *   prompt: "...",
 *   tools: [asPlugin(subAgent, provider)]
 * });
 * ```
 */
const AsPluginSchema = z.object({
  task: z.string().describe("The task to delegate to the agent"),
});

export function asPlugin(
  agent: AgentLike,
  provider: LLMProvider,
  options: { maxDepth?: number } = {}
): PluginDef<typeof AsPluginSchema> {
  const maxDepth = options.maxDepth ?? 5;

  return {
    description: `Delegate tasks to the ${agent.name} agent. Use this when you need specialized capabilities that ${agent.name} provides.`,
    name: agent.name,
    params: AsPluginSchema,
    run: async (input, _ctx): Promise<string> => {
      // Validate input
      const task = input.task;
      if (typeof task !== "string") {
        throw new AgentValidationError("task", typeof task);
      }

      const parentDepth = depthStorage?.getStore();
      const currentDepth = parentDepth ?? 0;

      if (currentDepth >= maxDepth) {
        throw new AgentRecursionError(maxDepth);
      }

      const result = depthStorage
        ? await depthStorage.run(currentDepth + 1, () => agent.run(task, provider))
        : await agent.run(task, provider);
      return result;
    },
  };
}
