import { describe, expect, it } from "bun:test";
import { createApp } from "../../../src/server/index.js";
import type { RegistryReader } from "../../../src/server/routes/agents.js";
import type { AgentDisplayInfo, GraphDisplayInfo } from "../../../src/shared/types.js";

class MockRegistry implements RegistryReader {
  async getAgents() {
    return [
      {
        name: "helper-agent",
        toDisplayInfo: (): AgentDisplayInfo => ({
          name: "helper-agent",
          promptPreview: "Helpful agent for triage.",
          tools: [{ name: "search" }, { name: "reply" }],
          guardrailsCount: { input: 1, output: 0 },
          handoffsCount: 1,
          maxIterations: 5,
          streaming: true,
          toolTimeout: 1000,
          toolConcurrency: 2,
        }),
      },
    ];
  }

  async getAgent(name: string) {
    const agent = (await this.getAgents()).find((entry) => entry.name === name);
    return agent;
  }

  async getGraphs() {
    return [
      {
        id: "support-graph",
        toDisplayInfo: (): GraphDisplayInfo => ({
          nodes: {
            start: { id: "start", type: "agent" },
            end: { id: "end", type: "fn" },
          },
          edges: [{ from: "start", to: "end" }],
          backEdges: [],
          executionOrder: ["start", "end"],
          entry: "start",
        }),
      },
    ];
  }

  async getGraph(id: string) {
    const graph = (await this.getGraphs()).find((entry) => entry.id === id);
    return graph;
  }
}

describe("Agent and Graph API", () => {
  const app = createApp({
    enableLogging: false,
    registry: new MockRegistry(),
  });

  it("GET /api/agents lists agent summaries", async () => {
    const response = await app.request("http://localhost/api/agents");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      agents: [
        {
          name: "helper-agent",
          description: "Helpful agent for triage.",
          toolCount: 2,
        },
      ],
    });
  });

  it("GET /api/agents/:name returns full agent detail", async () => {
    const response = await app.request("http://localhost/api/agents/helper-agent");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      agent: {
        name: "helper-agent",
        promptPreview: "Helpful agent for triage.",
        tools: [{ name: "search" }, { name: "reply" }],
        guardrailsCount: { input: 1, output: 0 },
        handoffsCount: 1,
        maxIterations: 5,
        streaming: true,
        toolTimeout: 1000,
        toolConcurrency: 2,
      },
    });
  });

  it("GET /api/graphs lists graph summaries", async () => {
    const response = await app.request("http://localhost/api/graphs");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      graphs: [
        {
          id: "support-graph",
          nodeCount: 2,
          edgeCount: 1,
        },
      ],
    });
  });

  it("GET /api/graphs/:id returns full graph detail", async () => {
    const response = await app.request("http://localhost/api/graphs/support-graph");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      graph: {
        nodes: {
          start: { id: "start", type: "agent" },
          end: { id: "end", type: "fn" },
        },
        edges: [{ from: "start", to: "end" }],
        backEdges: [],
        executionOrder: ["start", "end"],
        entry: "start",
      },
    });
  });

  it("returns 404 for missing agents and graphs", async () => {
    const missingAgent = await app.request("http://localhost/api/agents/missing");
    const missingGraph = await app.request("http://localhost/api/graphs/missing");

    expect(missingAgent.status).toBe(404);
    expect(await missingAgent.json()).toEqual({
      error: "Agent not found",
      code: "HTTP_404",
    });

    expect(missingGraph.status).toBe(404);
    expect(await missingGraph.json()).toEqual({
      error: "Graph not found",
      code: "HTTP_404",
    });
  });
});
