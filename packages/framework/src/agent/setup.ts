import { buildGetResultPlugin, isBackground, TaskManager } from "../background/index";
import { createHandoffToolDef } from "../handoff/handoff";
import type { HandoffTarget } from "../handoff/types";
import type { InternalPlugin } from "../plugin/index";
import { plugin as createPlugin } from "../plugin/index";
import type { AgentDef, ToolDef } from "../types/index";
import type { ToolMiddleware } from "../types/plugin-config";
import { createReadToolOutputPlugin } from "./read-tool-output";
import { pluginDefToToolDef } from "./tool-executor";

export interface ResolvedTool {
  middleware: Array<ToolMiddleware>;
  plugin: InternalPlugin;
}

export interface SetupContext {
  bgToolNames: Set<string>;
  handoffTargets: Array<HandoffTarget>;
  resolvedTools: Map<string, ResolvedTool>;
  taskManager: TaskManager | undefined;
  toolDefs: Array<ToolDef>;
}

function isInternalPlugin(tool: unknown): tool is InternalPlugin {
  return typeof (tool as InternalPlugin).execute === "function";
}

type ToolBindingShape = {
  middleware: Array<ToolMiddleware>;
  tool: { description: string; name: string; params: unknown; run: unknown };
};

function isToolBindingWithMiddleware(tool: unknown): tool is ToolBindingShape {
  return (
    typeof tool === "object" &&
    tool !== null &&
    "tool" in tool &&
    "middleware" in tool &&
    Array.isArray((tool as { middleware: unknown }).middleware)
  );
}

export function setupPlugins(def: AgentDef): SetupContext {
  const resolvedTools = new Map<string, ResolvedTool>();
  const toolDefs: Array<ToolDef> = [];
  const seenToolNames = new Set<string>();

  const bgToolNames = new Set<string>();
  for (const toolEntry of def.tools ?? []) {
    if (
      !isInternalPlugin(toolEntry) &&
      !isToolBindingWithMiddleware(toolEntry) &&
      isBackground(toolEntry)
    ) {
      bgToolNames.add(toolEntry.name);
    }
  }
  const hasBgTools = bgToolNames.size > 0;

  let taskManager: TaskManager | undefined;
  if (hasBgTools) {
    taskManager = new TaskManager();
    const getResultDef = buildGetResultPlugin(taskManager);
    resolvedTools.set(getResultDef.name, { middleware: [], plugin: createPlugin(getResultDef) });
    toolDefs.push(pluginDefToToolDef(getResultDef));
    seenToolNames.add(getResultDef.name);
  }

  if (def.truncation?.blobStore) {
    const readToolOutputDef = createReadToolOutputPlugin(def.truncation.blobStore);
    resolvedTools.set(readToolOutputDef.name, {
      middleware: [],
      plugin: createPlugin(readToolOutputDef),
    });
    toolDefs.push(pluginDefToToolDef(readToolOutputDef));
    seenToolNames.add(readToolOutputDef.name);
  }

  for (const toolEntry of def.tools ?? []) {
    if (isInternalPlugin(toolEntry)) {
      if (seenToolNames.has(toolEntry.name)) {
        throw new Error(`Duplicate tool name: ${toolEntry.name}`);
      }
      seenToolNames.add(toolEntry.name);
      resolvedTools.set(toolEntry.name, { middleware: [], plugin: toolEntry });
      toolDefs.push(pluginDefToToolDef(toolEntry));
    } else if (isToolBindingWithMiddleware(toolEntry)) {
      const toolName = toolEntry.tool.name;
      if (seenToolNames.has(toolName)) {
        throw new Error(`Duplicate tool name: ${toolName}`);
      }
      seenToolNames.add(toolName);
      resolvedTools.set(toolName, {
        middleware: toolEntry.middleware,
        plugin: createPlugin(toolEntry.tool as Parameters<typeof createPlugin>[0]),
      });
      toolDefs.push(pluginDefToToolDef(toolEntry.tool as Parameters<typeof pluginDefToToolDef>[0]));
    } else {
      const toolName = toolEntry.name;
      if (seenToolNames.has(toolName)) {
        throw new Error(`Duplicate tool name: ${toolName}`);
      }
      seenToolNames.add(toolName);
      resolvedTools.set(toolName, {
        middleware: [],
        plugin: createPlugin(toolEntry as Parameters<typeof createPlugin>[0]),
      });
      toolDefs.push(pluginDefToToolDef(toolEntry as Parameters<typeof pluginDefToToolDef>[0]));
    }
  }

  const handoffTargets: Array<HandoffTarget> = def.handoffs ?? [];
  for (const h of handoffTargets) {
    const handoffToolDef = createHandoffToolDef(h);
    toolDefs.push(pluginDefToToolDef(handoffToolDef));
  }

  return { bgToolNames, handoffTargets, resolvedTools, taskManager, toolDefs };
}

export {
  AgentFactoryRegistry,
  createCallAgentTool,
  createCreateAgentTool,
  createExecuteAgentTool,
} from "../agent-factory/index";

export type { AgentFactoryConfig, LLMProvider } from "../types/index";
