// =============================================================================
// @obsku/framework — Agent Factory Tools: Tool factory functions for dynamic agent creation
// =============================================================================

import { z } from "zod";
import type { LLMProvider, PluginDef } from "../types";
import type { AgentFactoryRegistry } from "./index";

const CreateAgentInputSchema = z.object({
  name: z.string(),
  prompt: z.string(),
  tools: z.array(z.string()).optional(),
});

const CallAgentInputSchema = z.object({
  name: z.string(),
  task: z.string(),
});

const ExecuteAgentInputSchema = z.object({
  prompt: z.string(),
  task: z.string(),
  tools: z.array(z.string()).optional(),
});

function formatValidationError(error: z.ZodError): string {
  const message = error.issues
    .map((issue) => {
      const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
      return `${path}: ${issue.message}`;
    })
    .join("; ");

  return JSON.stringify({ error: message });
}

function hasBoundContext(registry: AgentFactoryRegistry): boolean {
  return Reflect.get(registry as object, "_ctx") !== undefined;
}

/**
 * Create the create_agent tool
 */
export function createCreateAgentTool(
  registry: AgentFactoryRegistry,
  provider: LLMProvider
): PluginDef {
  return {
    description:
      "Create a new specialized agent dynamically. Call created agents later with call_agent using their name.",
    name: "create_agent",
    params: z.object({
      name: z.string().describe("Unique name for the new agent"),
      prompt: z.string().describe("System prompt/instructions for the agent"),
      tools: z
        .array(z.string())
        .optional()
        .describe("Optional list of parent tool names to make available to the child agent"),
    }),
    run: async (input, _ctx): Promise<string> => {
      const parsed = CreateAgentInputSchema.safeParse(input);
      if (!parsed.success) {
        if (!hasBoundContext(registry)) {
          throw new Error(formatValidationError(parsed.error));
        }

        return formatValidationError(parsed.error);
      }

      const { name: agentName, prompt: agentPrompt, tools: agentTools } = parsed.data;
      const result = registry.create(agentName, agentPrompt, agentTools, provider);

      if (result.success) {
        return `Agent "${agentName}" created successfully. Use call_agent with { name: "${agentName}", task } to invoke it.`;
      } else {
        return JSON.stringify({ error: result.error });
      }
    },
  };
}

/**
 * Create the call_agent tool
 */
export function createCallAgentTool(registry: AgentFactoryRegistry): PluginDef {
  return {
    description: "Call a previously created agent with a task.",
    name: "call_agent",
    params: z.object({
      name: z.string().describe("Name of the agent to call"),
      task: z.string().describe("Task to delegate to the agent"),
    }),
    run: async (input, _ctx): Promise<string> => {
      const parsed = CallAgentInputSchema.safeParse(input);
      if (!parsed.success) {
        return formatValidationError(parsed.error);
      }

      const { name: agentName, task } = parsed.data;
      return registry.call(agentName, task);
    },
  };
}

/**
 * Create the execute_agent tool (one-shot: create + run in single call)
 */
export function createExecuteAgentTool(
  registry: AgentFactoryRegistry,
  provider: LLMProvider
): PluginDef {
  return {
    description:
      "Execute a one-shot specialized agent. Creates an ephemeral agent with the given prompt, runs it with the task, and returns the result. The agent is not persisted. Use for single-use delegations.",
    name: "execute_agent",
    params: z.object({
      prompt: z.string().describe("System prompt/instructions for the ephemeral agent"),
      task: z.string().describe("The task to execute"),
      tools: z
        .array(z.string())
        .optional()
        .describe("Optional list of parent tool names to make available to the agent"),
    }),
    run: async (input, _ctx): Promise<string> => {
      const parsed = ExecuteAgentInputSchema.safeParse(input);
      if (!parsed.success) {
        return formatValidationError(parsed.error);
      }

      const { prompt: agentPrompt, task, tools: agentTools } = parsed.data;
      return registry.execute(agentPrompt, task, agentTools, provider);
    },
  };
}
