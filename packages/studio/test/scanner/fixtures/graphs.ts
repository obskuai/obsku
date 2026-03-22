import type { AgentDef } from "@obsku/framework";
import { graph } from "@obsku/framework";

const approvalAgent: AgentDef = {
  name: "approval-agent",
  prompt: "Approve requests.",
};

export const nestedGraph = graph({
  nodes: [
    {
      id: "child",
      executor: async (input: unknown) => input,
    },
  ],
  edges: [],
  entry: "child",
  provider: undefined as never,
});

const supportGraph = graph({
  nodes: [
    {
      id: "start",
      description: "Start node",
      executor: {
        name: "embedded-agent",
        prompt: "Handle first step.",
      },
    },
    {
      id: "approval",
      executor: approvalAgent,
    },
    {
      id: "nested",
      executor: nestedGraph,
    },
    {
      id: "finish",
      executor: async (input: unknown) => input,
    },
  ],
  edges: [
    { from: "start", to: "approval" },
    { from: "approval", to: "nested" },
    { from: "nested", to: "finish" },
    { from: "finish", to: "approval", back: true },
  ],
  entry: "start",
  provider: undefined as never,
});

export { supportGraph as customerSupportGraph };

export default graph({
  nodes: [
    {
      id: "only",
      executor: async () => "done",
    },
  ],
  edges: [],
  entry: "only",
  provider: undefined as never,
});
