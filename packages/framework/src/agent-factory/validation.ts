import type { AgentIterationContext } from "../agent/agent-loop/index";

export type AgentFactoryCreateResult = { success: true } | { error: string; success: false };

const UNBOUND_CONTEXT_ERROR =
  "AgentFactoryRegistry: context not bound. Call setContext() before using factory tools.";

export function requireBoundAgentFactoryContext(
  ctx: AgentIterationContext | undefined
): AgentIterationContext {
  if (!ctx) {
    throw new Error(UNBOUND_CONTEXT_ERROR);
  }

  return ctx;
}

export function validateAgentCreation(input: {
  ctx: AgentIterationContext;
  existingAgentCount: number;
  hasAgent: boolean;
  maxAgents: number;
  name: string;
}): AgentFactoryCreateResult {
  const { ctx, existingAgentCount, hasAgent, maxAgents, name } = input;

  if (hasAgent) {
    return { error: `Agent "${name}" already exists`, success: false };
  }

  if (existingAgentCount >= maxAgents) {
    return {
      error: `Max agents limit reached (${maxAgents})`,
      success: false,
    };
  }

  const existingTool = ctx.toolDefs.find((tool) => tool.name === name);
  if (existingTool) {
    return {
      error: `Name "${name}" conflicts with existing tool`,
      success: false,
    };
  }

  return { success: true };
}
