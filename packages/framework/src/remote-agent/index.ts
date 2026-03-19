// =============================================================================
// @obsku/framework — asRemoteAgent() factory + re-exports
// =============================================================================

import type { PluginDef } from "../types";
import { z } from "zod";
import { callRemoteAgentArn, callRemoteAgentUrl } from "./http";
import type { RemoteAgentConfig } from "./types";
import { isUrlConfig, RemoteAgentError } from "./types";

/**
 * Wrap a remote A2A agent as a PluginDef, enabling agents to call remote agents as tools.
 *
 * Supports two modes:
 * - URL mode: Direct HTTP endpoint implementing A2A protocol (JSON-RPC 2.0)
 * - ARN mode: AgentCore-hosted agents via AWS SDK (placeholder implementation)
 *
 * The plugin exposes a single `task` parameter (string) that is sent to the remote agent.
 *
 * @param name - Name for the plugin (used in tool calling)
 * @param config - Configuration object (discriminated union: url OR arn)
 * @returns PluginDef that can be used in agent.tools array
 *
 * @example
 * ```typescript
 * // URL mode - any A2A agent
 * const remotePlugin = asRemoteAgent("researcher", {
 *   url: "https://agent.example.com/a2a",
 *   timeout: 60_000,
 * });
 *
 * // ARN mode - AgentCore-hosted
 * const awsPlugin = asRemoteAgent("aws-agent", {
 *   arn: "arn:aws:bedrock:us-east-1:123456789:agent/MyAgent",
 *   region: "us-east-1",
 * });
 *
 * const mainAgent = agent({
 *   name: "main",
 *   prompt: "...",
 *   tools: [remotePlugin],
 * });
 * ```
 */
const RemoteAgentSchema = z.object({
  task: z.string().describe("The task to delegate to the remote agent"),
});

export function asRemoteAgent(
  name: string,
  config: RemoteAgentConfig
): PluginDef<typeof RemoteAgentSchema> {
  return {
    description: `Delegate tasks to the remote agent "${name}". Use this when you need specialized capabilities that ${name} provides.`,
    name,
    params: RemoteAgentSchema,
    run: async (input, _ctx): Promise<string> => {
      // Validate input
      const task = input.task;
      if (typeof task !== "string") {
        throw new RemoteAgentError(
          name,
          `Invalid input: expected "task" to be a string, got ${typeof task}`
        );
      }

      // Route to appropriate implementation based on config type
      if (isUrlConfig(config)) {
        return callRemoteAgentUrl(name, config, task);
      } else {
        return callRemoteAgentArn(name, config, task);
      }
    },
  };
}

export type { RemoteAgentArnConfig, RemoteAgentConfig, RemoteAgentUrlConfig } from "./types";
// Re-exports for public API
export { JsonRpcError, RemoteAgentError } from "./types";
