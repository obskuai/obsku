import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Registry } from "../../scanner/registry.js";
import {
  AgentDetailResponse,
  AgentListResponse,
  GraphDetailResponse,
  GraphListResponse,
} from "../../shared/schemas.js";

export interface RegistryReader {
  getAgent(name: string): Promise<{ toDisplayInfo(): unknown } | undefined>;
  getAgents(): Promise<
    Array<{ name: string; toDisplayInfo(): { promptPreview: string; tools: unknown[] } }>
  >;
  getGraph(id: string): Promise<{ toDisplayInfo(): unknown } | undefined>;
  getGraphs(): Promise<
    Array<{
      id: string;
      toDisplayInfo(): { backEdges: unknown[]; edges: unknown[]; nodes: Record<string, unknown> };
    }>
  >;
}

export interface AgentsRouteOptions {
  registry?: RegistryReader;
  rootDir?: string;
}

export function createAgentsRoute(options: AgentsRouteOptions = {}): Hono {
  const app = new Hono();
  let registry = options.registry;

  function getRegistry(): RegistryReader {
    registry ??= new Registry({ rootDir: options.rootDir });
    return registry;
  }

  app.get("/agents", async (c) => {
    const agents = await getRegistry().getAgents();
    const response = AgentListResponse.parse({
      success: true,
      agents: agents.map((agent) => {
        const display = agent.toDisplayInfo();
        return {
          name: agent.name,
          description: display.promptPreview,
          toolCount: display.tools.length,
        };
      }),
    });

    return c.json(response);
  });

  app.get("/agents/:name", async (c) => {
    const agent = await getRegistry().getAgent(c.req.param("name"));
    if (!agent) {
      throw new HTTPException(404, { message: "Agent not found" });
    }

    const response = AgentDetailResponse.parse({
      success: true,
      agent: agent.toDisplayInfo(),
    });

    return c.json(response);
  });

  app.get("/graphs", async (c) => {
    const graphs = await getRegistry().getGraphs();
    const response = GraphListResponse.parse({
      success: true,
      graphs: graphs.map((graph) => {
        const display = graph.toDisplayInfo();
        return {
          edgeCount: display.edges.length + display.backEdges.length,
          id: graph.id,
          nodeCount: Object.keys(display.nodes).length,
        };
      }),
    });

    return c.json(response);
  });

  app.get("/graphs/:id", async (c) => {
    const graph = await getRegistry().getGraph(c.req.param("id"));
    if (!graph) {
      throw new HTTPException(404, { message: "Graph not found" });
    }

    const response = GraphDetailResponse.parse({
      success: true,
      graph: graph.toDisplayInfo(),
    });

    return c.json(response);
  });

  return app;
}
