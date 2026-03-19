import type { AgentIterationContext } from "../agent/agent-loop/index";
import type { AgentFactoryConfig, LLMProvider } from "../types";
import {
  buildChildAgentDef,
  buildChildAgentTools,
  callRegisteredAgent,
  executeEphemeralAgent,
  type RegisteredAgentMap,
  registerAgentCallMetadata,
} from "./execution";
import {
  type AgentFactoryCreateResult,
  requireBoundAgentFactoryContext,
  validateAgentCreation,
} from "./validation";

export class AgentFactoryRegistry {
  private _agents: RegisteredAgentMap = new Map();
  private _config: { allowedChildTools: string[] | undefined; maxAgents: number; maxDepth: number };
  private _ctx: AgentIterationContext | undefined;

  constructor(_provider: LLMProvider, config?: AgentFactoryConfig) {
    this._config = {
      allowedChildTools: config?.allowedChildTools,
      maxAgents: config?.maxAgents ?? 10,
      maxDepth: config?.maxDepth ?? 5,
    };
  }

  setContext(ctx: AgentIterationContext): void {
    this._ctx = ctx;
  }

  has(name: string): boolean {
    return this._agents.has(name);
  }

  create(
    name: string,
    prompt: string,
    tools: string[] | undefined,
    provider: LLMProvider
  ): { error?: string; success: boolean } {
    const ctx = requireBoundAgentFactoryContext(this._ctx);
    const validation = this._validateCreate(name, ctx);
    if (!validation.success) {
      return validation;
    }

    const childTools = buildChildAgentTools({
      allowedChildTools: this._config.allowedChildTools,
      ctx,
      tools,
    });
    const childDef = buildChildAgentDef(name, prompt, childTools);

    this._agents.set(name, { def: childDef, provider });
    registerAgentCallMetadata(ctx, name);

    return validation;
  }

  async call(name: string, task: string): Promise<string> {
    return callRegisteredAgent(this._agents, this._config.maxDepth, name, task);
  }

  async execute(
    prompt: string,
    task: string,
    tools: string[] | undefined,
    provider: LLMProvider
  ): Promise<string> {
    return executeEphemeralAgent({
      ctx: this._ctx,
      maxDepth: this._config.maxDepth,
      prompt,
      provider,
      task,
      tools,
    });
  }

  private _validateCreate(name: string, ctx: AgentIterationContext): AgentFactoryCreateResult {
    return validateAgentCreation({
      ctx,
      existingAgentCount: this._agents.size,
      hasAgent: this._agents.has(name),
      maxAgents: this._config.maxAgents,
      name,
    });
  }
}
