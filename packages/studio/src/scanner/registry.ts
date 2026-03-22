import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Agent, AgentDef, Graph, GraphNode } from "@obsku/framework";
import type {
  AgentDisplayInfo,
  GraphDisplayInfo,
  MemoryDisplayInfo,
  ToolDisplayInfo,
} from "../shared/types.js";
import type { AgentScanResult } from "./agent-scanner.js";
import { scanAgents } from "./agent-scanner.js";
import { loadStudioConfig } from "./config-loader.js";
import type { GraphScanResult } from "./graph-scanner.js";
import { scanGraphs } from "./graph-scanner.js";

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_STREAMING = false;
const DEFAULT_TOOL_CONCURRENCY = 3;
const DEFAULT_TOOL_TIMEOUT = 30_000;
const PROMPT_PREVIEW_LIMIT = 160;

export type ExecutableAgent = Agent | AgentDef;
type AgentTool = NonNullable<AgentDef["tools"]>[number];

type RegistrySource = "config" | "scan";

interface RegistryAgentRecord {
  display: AgentDisplayInfo;
  executable?: ExecutableAgent;
  exportName?: string;
  filePath?: string;
  modulePath?: string;
  name: string;
  source: RegistrySource;
}

interface RegistryGraphRecord {
  display: GraphDisplayInfo;
  executable?: Graph;
  exportName?: string;
  filePath?: string;
  id: string;
  modulePath?: string;
  source: RegistrySource;
}

export class RegisteredAgent {
  constructor(private readonly record: RegistryAgentRecord) {}

  get name(): string {
    return this.record.name;
  }

  get source(): RegistrySource {
    return this.record.source;
  }

  toDisplayInfo(): AgentDisplayInfo {
    return this.record.display;
  }
}

export class RegisteredGraph {
  constructor(private readonly record: RegistryGraphRecord) {}

  get id(): string {
    return this.record.id;
  }

  get source(): RegistrySource {
    return this.record.source;
  }

  toDisplayInfo(): GraphDisplayInfo {
    return this.record.display;
  }
}

export interface RegistryOptions {
  rootDir?: string;
}

export class Registry {
  private readonly rootDir: string;
  private agents = new Map<string, RegistryAgentRecord>();
  private graphs = new Map<string, RegistryGraphRecord>();
  private refreshPromise: Promise<void>;

  constructor(options: RegistryOptions = {}) {
    this.rootDir = resolve(options.rootDir ?? process.cwd());
    this.refreshPromise = this.refresh();
  }

  async getAgents(): Promise<RegisteredAgent[]> {
    await this.refreshPromise;
    return [...this.agents.values()].map((record) => new RegisteredAgent(record));
  }

  async getAgent(name: string): Promise<RegisteredAgent | undefined> {
    await this.refreshPromise;
    const record = this.agents.get(name);
    return record ? new RegisteredAgent(record) : undefined;
  }

  async getExecutableAgent(name: string): Promise<ExecutableAgent | undefined> {
    await this.refreshPromise;
    const record = this.agents.get(name);
    if (!record) {
      return undefined;
    }

    if (record.executable) {
      return record.executable;
    }

    if (!record.filePath) {
      return undefined;
    }

    const loaded = await importFromFile(record.filePath, record.exportName);
    record.executable = loaded as ExecutableAgent;
    return record.executable;
  }

  async getGraphs(): Promise<RegisteredGraph[]> {
    await this.refreshPromise;
    return [...this.graphs.values()].map((record) => new RegisteredGraph(record));
  }

  async getGraph(id: string): Promise<RegisteredGraph | undefined> {
    await this.refreshPromise;
    const record = this.graphs.get(id);
    return record ? new RegisteredGraph(record) : undefined;
  }

  async getExecutableGraph(id: string): Promise<Graph | undefined> {
    await this.refreshPromise;
    const record = this.graphs.get(id);
    if (!record) {
      return undefined;
    }

    if (record.executable) {
      return record.executable;
    }

    if (!record.filePath) {
      return undefined;
    }

    const loaded = await importFromFile(record.filePath, record.exportName);
    record.executable = loaded as Graph;
    return record.executable;
  }

  async refresh(): Promise<void> {
    this.refreshPromise = this.load();
    await this.refreshPromise;
  }

  private async load(): Promise<void> {
    const configResult = await loadStudioConfig(this.rootDir);
    const scanRootDir = resolve(this.rootDir, configResult?.config.scanDir ?? ".");

    const scannedAgents = scanAgents({ rootDir: scanRootDir });
    const scannedGraphs = scanGraphs({ rootDir: scanRootDir });

    const nextAgents = new Map<string, RegistryAgentRecord>();
    const nextGraphs = new Map<string, RegistryGraphRecord>();

    for (const agent of configResult?.config.agents ?? []) {
      nextAgents.set(agent.name, {
        display: agentToDisplayInfo(agent),
        executable: agent,
        name: agent.name,
        source: "config",
      });
    }

    for (const graph of configResult?.config.graphs ?? []) {
      nextGraphs.set(graph.entry, {
        display: graphToDisplayInfo(graph),
        executable: graph,
        id: graph.entry,
        source: "config",
      });
    }

    for (const agent of scannedAgents) {
      if (nextAgents.has(agent.metadata.name)) {
        continue;
      }

      nextAgents.set(agent.metadata.name, recordFromScannedAgent(agent));
    }

    for (const graph of scannedGraphs) {
      if (nextGraphs.has(graph.metadata.entry)) {
        continue;
      }

      nextGraphs.set(graph.metadata.entry, recordFromScannedGraph(graph));
    }

    this.agents = nextAgents;
    this.graphs = nextGraphs;
  }
}

function recordFromScannedAgent(agent: AgentScanResult): RegistryAgentRecord {
  return {
    display: agent.metadata,
    exportName: agent.exportName,
    filePath: agent.filePath,
    modulePath: agent.modulePath,
    name: agent.metadata.name,
    source: "scan",
  };
}

function recordFromScannedGraph(graph: GraphScanResult): RegistryGraphRecord {
  return {
    display: graph.metadata,
    exportName: graph.exportName,
    filePath: graph.filePath,
    id: graph.metadata.entry,
    modulePath: graph.modulePath,
    source: "scan",
  };
}

async function importFromFile(filePath: string, exportName: string | undefined): Promise<unknown> {
  const imported = await importFreshModule(filePath);
  const loaded = exportName === "default" ? imported.default : imported[exportName ?? "default"];

  if (loaded === undefined) {
    throw new Error(`Export ${exportName ?? "default"} not found in ${filePath}`);
  }

  return loaded;
}

async function importFreshModule(filePath: string): Promise<Record<string, unknown>> {
  const resolvedPath = resolve(filePath);
  const tempPath = `${resolvedPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`;
  writeFileSync(tempPath, readFileSync(resolvedPath, "utf8"));

  try {
    return (await import(pathToFileURL(tempPath).href)) as Record<string, unknown>;
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function agentToDisplayInfo(agent: ExecutableAgent): AgentDisplayInfo {
  const def = isAgentDefLike(agent) ? agent : undefined;
  const prompt = def ? promptToString(def.prompt) : "";

  return {
    guardrailsCount: {
      input: countItems(def?.guardrails?.input),
      output: countItems(def?.guardrails?.output),
    },
    handoffsCount: countItems(def?.handoffs),
    maxIterations: def?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    memory: getMemoryDisplayInfo(def?.memory),
    name: agent.name,
    promptPreview: truncatePrompt(prompt),
    streaming: def?.streaming ?? DEFAULT_STREAMING,
    toolConcurrency: def?.toolConcurrency ?? DEFAULT_TOOL_CONCURRENCY,
    toolTimeout: def?.toolTimeout ?? DEFAULT_TOOL_TIMEOUT,
    tools: getToolDisplayInfo(def?.tools),
  };
}

function graphToDisplayInfo(graph: Graph): GraphDisplayInfo {
  const nodes = Object.fromEntries(
    [...graph.nodes.entries()].map(([id, node]) => [
      id,
      {
        description: node.description,
        id,
        type: getNodeType(node),
      },
    ])
  );

  return {
    backEdges: graph.backEdges.map((edge) => ({ back: edge.back, from: edge.from, to: edge.to })),
    edges: graph.edges.map((edge) => ({ back: edge.back, from: edge.from, to: edge.to })),
    entry: graph.entry,
    executionOrder: [...graph.executionOrder],
    nodes,
  };
}

function getNodeType(node: GraphNode): "agent" | "graph" | "fn" {
  const executor = node.executor;

  if (typeof executor === "function") {
    return "fn";
  }

  if (executor && typeof executor === "object") {
    if ("nodes" in executor && "edges" in executor) {
      return "graph";
    }
    if ("name" in executor) {
      return "agent";
    }
  }

  return "fn";
}

function getToolDisplayInfo(tools: AgentDef["tools"] | undefined): ToolDisplayInfo[] {
  if (!tools) {
    return [];
  }

  return tools.map((tool) => {
    if (tool && typeof tool === "object" && "tool" in tool) {
      return getToolDisplayInfo([tool.tool as AgentTool])[0] ?? { name: "unknown" };
    }

    if (tool && typeof tool === "object" && "name" in tool && typeof tool.name === "string") {
      const description =
        "description" in tool && typeof tool.description === "string"
          ? tool.description
          : undefined;
      return { description, name: tool.name };
    }

    return { name: "unknown" };
  });
}

function getMemoryDisplayInfo(
  memory: AgentDef["memory"] | undefined
): MemoryDisplayInfo | undefined {
  if (!memory) {
    return undefined;
  }

  const config = isMemoryProvider(memory) ? undefined : (memory as Record<string, unknown>);
  if (!config) {
    return { type: "custom" };
  }

  if (config.enabled === false) {
    return { type: "none" };
  }

  if (typeof config.maxMessages === "number") {
    return { maxMessages: config.maxMessages, type: "buffer" };
  }

  if (config.longTermMemory || config.entityMemory) {
    return { type: "summarization" };
  }

  return { type: "custom" };
}

function promptToString(prompt: AgentDef["prompt"]): string {
  if (typeof prompt === "string") {
    return prompt;
  }

  if (typeof prompt === "function") {
    try {
      const value = prompt({} as never);
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  }

  return "";
}

function truncatePrompt(prompt: string): string {
  if (prompt.length <= PROMPT_PREVIEW_LIMIT) {
    return prompt;
  }

  return `${prompt.slice(0, PROMPT_PREVIEW_LIMIT - 3)}...`;
}

function countItems(value: ReadonlyArray<unknown> | undefined): number {
  return value?.length ?? 0;
}

function isAgentDefLike(agent: ExecutableAgent): agent is AgentDef {
  return "prompt" in agent;
}

function isMemoryProvider(memory: NonNullable<AgentDef["memory"]>): boolean {
  return "load" in memory && "save" in memory;
}
