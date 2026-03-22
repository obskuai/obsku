import type { AgentDef, Graph } from "@obsku/framework";

const testAgent: AgentDef = {
  name: "test-agent",
  prompt: "You are a test agent.",
  maxIterations: 5,
};

const testGraph = {
  entry: "start",
  nodes: new Map([
    [
      "start",
      {
        id: "start",
        executor: testAgent,
      },
    ],
  ]),
  edges: [],
  adjacency: new Map(),
  backEdges: [],
  executionOrder: ["start"],
  config: { maxConcurrent: 3, nodeTimeout: 300000 },
  provider: {} as any,
} satisfies Graph;

export default {
  agents: [testAgent],
  graphs: [testGraph],
  scanDir: "./agents",
  scanIgnore: ["node_modules", "dist"],
};
