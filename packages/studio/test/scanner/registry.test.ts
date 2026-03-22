import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Registry } from "../../src/scanner/registry.js";

describe("Registry", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(import.meta.dir, "tmp-registry-"));
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  it("merges config and scanned definitions with config priority", async () => {
    writeRegistryFixture(tempDir, {
      agents: `
import type { AgentDef } from "@obsku/framework";

export const scannedShared: AgentDef = {
  name: "shared-agent",
  prompt: "scanned prompt",
};

export const scannedOnly: AgentDef = {
  name: "scanned-only",
  prompt: "scan only prompt",
};
`,
      config: `
import { graph } from "@obsku/framework";

const configAgent = {
  name: "shared-agent",
  prompt: "config prompt",
  tools: [{ name: "cfg-tool", description: "from config" }],
  guardrails: { input: [async () => ({ allow: true })], output: [] },
  handoffs: [{ agent: { name: "handoff-agent", prompt: "handoff" }, description: "handoff" }],
  memory: { enabled: true, longTermMemory: true },
  maxIterations: 2,
  streaming: true,
  toolConcurrency: 5,
  toolTimeout: 42000,
};

const configGraph = graph({
  nodes: [
    { id: "shared-entry", executor: configAgent },
    { id: "done", executor: async (input: unknown) => input },
  ],
  edges: [{ from: "shared-entry", to: "done" }],
  entry: "shared-entry",
  provider: undefined as never,
});

export default {
  agents: [configAgent],
  graphs: [configGraph],
};
`,
      graphs: `
import { graph } from "@obsku/framework";

export const scannedGraph = graph({
  nodes: [{ id: "scanned-entry", executor: async (input: unknown) => input }],
  edges: [],
  entry: "scanned-entry",
  provider: undefined as never,
});

export const sharedGraph = graph({
  nodes: [{ id: "shared-entry", executor: async (input: unknown) => input }],
  edges: [],
  entry: "shared-entry",
  provider: undefined as never,
});
`,
    });

    const registry = new Registry({ rootDir: tempDir });

    const agents = await registry.getAgents();
    const graphs = await registry.getGraphs();
    const sharedAgent = await registry.getAgent("shared-agent");
    const sharedGraph = await registry.getGraph("shared-entry");
    const scannedExecutable = await registry.getExecutableAgent("scanned-only");
    const scannedGraphExecutable = await registry.getExecutableGraph("scanned-entry");

    expect(agents.map((agent) => agent.name)).toEqual(["shared-agent", "scanned-only"]);
    expect(graphs.map((entry) => entry.id)).toEqual(["shared-entry", "scanned-entry"]);

    expect(sharedAgent?.source).toBe("config");
    expect(sharedAgent?.toDisplayInfo()).toEqual({
      guardrailsCount: { input: 1, output: 0 },
      handoffsCount: 1,
      maxIterations: 2,
      memory: { type: "summarization" },
      name: "shared-agent",
      promptPreview: "config prompt",
      streaming: true,
      toolConcurrency: 5,
      toolTimeout: 42000,
      tools: [{ description: "from config", name: "cfg-tool" }],
    });

    expect(sharedGraph?.source).toBe("config");
    expect(sharedGraph?.toDisplayInfo()).toEqual({
      backEdges: [],
      edges: [{ from: "shared-entry", to: "done" }],
      entry: "shared-entry",
      executionOrder: ["shared-entry", "done"],
      nodes: {
        done: { id: "done", type: "fn" },
        "shared-entry": { id: "shared-entry", type: "agent" },
      },
    });

    expect(scannedExecutable).toMatchObject({ name: "scanned-only", prompt: "scan only prompt" });
    expect(scannedGraphExecutable?.entry).toBe("scanned-entry");
  }, 20000);

  it("loads scanned fixtures and imports executable exports dynamically", async () => {
    writeRegistryFixture(tempDir, {
      agents: `
import type { AgentDef } from "@obsku/framework";

const echoTool = { name: "echoTool" } as const;
const delegateTool = { name: "delegateTool" } as const;

export const helperAgent = createAgent({
  name: "helper-agent",
  prompt: "You help users quickly.",
  tools: [echoTool, { middleware: [], tool: delegateTool as any }],
});

export const scannedAgentDef: AgentDef = {
  name: "agent-def",
  prompt: "Typed export",
};

function createAgent(def: AgentDef): AgentDef {
  return def;
}
`,
      config: `export default {};`,
      graphs: `
import type { AgentDef } from "@obsku/framework";
import { graph } from "@obsku/framework";

const approvalAgent: AgentDef = {
  name: "approval-agent",
  prompt: "Approve requests.",
};

export const supportGraph = graph({
  nodes: [
    { id: "start", executor: approvalAgent },
    { id: "finish", executor: async (input: unknown) => input },
  ],
  edges: [{ from: "start", to: "finish" }],
  entry: "start",
  provider: undefined as never,
});
`,
    });

    const registry = new Registry({ rootDir: tempDir });

    const helperAgent = await registry.getAgent("helper-agent");
    const supportGraph = await registry.getGraph("start");
    const executableAgent = await registry.getExecutableAgent("helper-agent");
    const executableGraph = await registry.getExecutableGraph("start");

    expect(helperAgent?.source).toBe("scan");
    expect(helperAgent?.toDisplayInfo().tools).toEqual([
      { name: "echoTool" },
      { name: "delegateTool" },
    ]);
    expect(supportGraph?.source).toBe("scan");
    expect(executableAgent).toMatchObject({
      name: "helper-agent",
      prompt: "You help users quickly.",
    });
    expect(executableGraph?.entry).toBe("start");
  }, 20000);

  it("refreshes merged results", async () => {
    writeRegistryFixture(tempDir, {
      agents: `
import type { AgentDef } from "@obsku/framework";

export const initialAgent: AgentDef = {
  name: "initial-agent",
  prompt: "before refresh",
};
`,
      config: `export default {};`,
      graphs: `
import { graph } from "@obsku/framework";

export const initialGraph = graph({
  nodes: [{ id: "initial-entry", executor: async (input: unknown) => input }],
  edges: [],
  entry: "initial-entry",
  provider: undefined as never,
});
`,
    });

    const registry = new Registry({ rootDir: tempDir });

    expect((await registry.getAgents()).map((agent) => agent.name)).toEqual(["initial-agent"]);
    expect((await registry.getGraphs()).map((entry) => entry.id)).toEqual(["initial-entry"]);

    writeRegistryFixture(tempDir, {
      agents: `
import type { AgentDef } from "@obsku/framework";

export const refreshedAgent: AgentDef = {
  name: "refreshed-agent",
  prompt: "after refresh",
};
`,
      config: `
import { graph } from "@obsku/framework";

const configGraph = graph({
  nodes: [{ id: "config-entry", executor: async (input: unknown) => input }],
  edges: [],
  entry: "config-entry",
  provider: undefined as never,
});

export default {
  graphs: [configGraph],
};
`,
      graphs: `export {};`,
    });

    await registry.refresh();

    expect((await registry.getAgents()).map((agent) => agent.name)).toEqual(["refreshed-agent"]);
    expect((await registry.getGraphs()).map((entry) => entry.id)).toEqual(["config-entry"]);
  }, 20000);
});

function writeRegistryFixture(
  rootDir: string,
  files: { agents: string; config: string; graphs: string }
): void {
  writeFileSync(join(rootDir, "agents.ts"), files.agents.trimStart());
  writeFileSync(join(rootDir, "graphs.ts"), files.graphs.trimStart());
  writeFileSync(join(rootDir, "studio.config.ts"), files.config.trimStart());
}
