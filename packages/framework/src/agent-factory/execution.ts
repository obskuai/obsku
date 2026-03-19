import { Effect } from "effect";
import { z } from "zod";
import type { AgentIterationContext } from "../agent/agent-loop/index";
import { registerDynamicPlugin } from "../agent/agent-loop/index";
import { agent } from "../agent/index";
import { DEFAULTS } from "../defaults";
import type { InternalPlugin } from "../plugin/index";
import { paramDefToZod } from "../plugin/index";
import type { AgentDef, LLMProvider, PluginDef, PluginRunOutput, ToolDef } from "../types";
import { formatError } from "../utils";
import { checkDepthLimit, getCurrentDepth, runWithDepth } from "./depth";
import { requireBoundAgentFactoryContext } from "./validation";

const PluginRunOutputSchema = z.union([
  z.string(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.boolean(),
  z.number(),
  z.null(),
  z.undefined(),
]);

function parsePluginRunOutput(output: unknown): PluginRunOutput {
  return PluginRunOutputSchema.parse(output);
}

export type RegisteredAgentEntry = { def: AgentDef; provider: LLMProvider };
export type RegisteredAgentMap = Map<string, RegisteredAgentEntry>;

export function buildChildAgentTools(input: {
  allowedChildTools?: Array<string>;
  ctx?: AgentIterationContext;
  tools?: Array<string>;
}): Array<PluginDef> {
  const toolNames = input.tools && input.tools.length > 0 ? input.tools : input.allowedChildTools;
  if (!toolNames || toolNames.length === 0) {
    return [];
  }

  const ctx = requireBoundAgentFactoryContext(input.ctx);
  const childTools: Array<PluginDef> = [];

  for (const toolName of toolNames) {
    const parentPlugin = ctx.resolvedTools.get(toolName)?.plugin;
    if (parentPlugin) {
      childTools.push(convertInternalPluginToPluginDef(parentPlugin));
    }
  }

  return childTools;
}

export function buildChildAgentDef(
  name: string,
  prompt: string,
  tools: Array<PluginDef>
): AgentDef {
  return {
    maxIterations: DEFAULTS.agentFactory.maxIterations,
    name,
    prompt,
    tools,
  };
}

export function registerAgentCallMetadata(ctx: AgentIterationContext, name: string): void {
  const callToolName = `call_${name}`;
  registerDynamicPlugin(
    ctx,
    callToolName,
    createDirectCallGuardPlugin(name),
    createDynamicCallToolDef(name)
  );
}

export async function callRegisteredAgent(
  agents: RegisteredAgentMap,
  maxDepth: number,
  name: string,
  task: string
): Promise<string> {
  const agentEntry = agents.get(name);
  if (!agentEntry) {
    return JSON.stringify({ error: `Agent "${name}" not found` });
  }

  const prepared = prepareExecution(maxDepth);
  if (prepared.error) {
    return JSON.stringify({ error: prepared.error });
  }

  try {
    return await runWithDepth(prepared.currentDepth, () =>
      agent(agentEntry.def).run(task, agentEntry.provider)
    );
  } catch (error: unknown) {
    return JSON.stringify({ error: formatError(error), cause: formatError(error) });
  }
}

export async function executeEphemeralAgent(input: {
  ctx?: AgentIterationContext;
  maxDepth: number;
  prompt: string;
  provider: LLMProvider;
  task: string;
  tools?: Array<string>;
}): Promise<string> {
  const prepared = prepareExecution(input.maxDepth);
  if (prepared.error) {
    return JSON.stringify({ error: prepared.error });
  }

  const childTools = buildChildAgentTools({ ctx: input.ctx, tools: input.tools });
  const childDef = buildChildAgentDef(`ephemeral-${Date.now()}`, input.prompt, childTools);

  try {
    return await runWithDepth(prepared.currentDepth, () =>
      agent(childDef).run(input.task, input.provider)
    );
  } catch (error: unknown) {
    return JSON.stringify({ error: formatError(error), cause: formatError(error) });
  }
}

function prepareExecution(maxDepth: number): { currentDepth: number; error?: string } {
  const currentDepth = getCurrentDepth();
  const depthError = checkDepthLimit(currentDepth, maxDepth);
  return depthError ? { currentDepth, error: depthError } : { currentDepth };
}

function createDynamicCallToolDef(name: string): ToolDef {
  return {
    description: `Call the ${name} agent with a task`,
    inputSchema: {
      properties: { task: { description: "The task to delegate to the agent", type: "string" } },
      required: ["task"],
      type: "object",
    },
    name: `call_${name}`,
  };
}

function createDirectCallGuardPlugin(name: string): InternalPlugin {
  const callToolName = `call_${name}`;

  return {
    description: `Call the ${name} agent with a task`,
    execute: () =>
      Effect.die(
        new Error(
          `[AgentFactory] ${callToolName}.execute() invoked directly — ` +
            `use the general "call_agent" tool with { name: "${name}", task } instead.`
        )
      ),
    name: callToolName,
    params: {
      task: { required: true, type: "string" },
    },
  };
}

function convertInternalPluginToPluginDef(internal: InternalPlugin): PluginDef {
  const params = z.object(
    Object.fromEntries(
      Object.entries(internal.params).map(([key, value]) => [key, paramDefToZod(value)])
    )
  );

  return {
    description: internal.description,
    name: internal.name,
    params,
    run: async (input, _ctx) => {
      const validatedInput = params.parse(input);
      const output = await Effect.runPromise(internal.execute(validatedInput));
      return parsePluginRunOutput(output);
    },
  };
}
