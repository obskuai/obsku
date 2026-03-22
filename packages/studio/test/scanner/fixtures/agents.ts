import type { AgentDef } from "@obsku/framework";
import { agent } from "@obsku/framework";

const echoTool = { description: "Echo back input", name: "echoTool" } as any;
const delegateTool = { description: "Delegate work", name: "delegateTool" } as any;

export const helperAgent = agent({
  name: "helper-agent",
  prompt: "You help users quickly.",
  tools: [echoTool, { middleware: [], tool: delegateTool }],
  maxIterations: 7,
  streaming: true,
  memory: {
    enabled: true,
    longTermMemory: true,
    maxFactsToInject: 4,
  },
  handoffs: [
    {
      agent: { name: "triage-agent", prompt: "Route complex work." },
      description: "Escalate to triage",
    },
  ],
  guardrails: {
    input: [async () => ({ allow: true })],
    output: [async () => ({ allow: true }), async () => ({ allow: true })],
  },
});

const escalationAgent: AgentDef = {
  name: "escalation-agent",
  prompt: () => "Escalate unresolved issues.",
  tools: [delegateTool],
  memory: {
    enabled: false,
  },
  maxIterations: 3,
};

export { escalationAgent as typedEscalationAgent };

export default createAgent({
  name: "factory-agent",
  prompt: `Work through the queue.`,
  tools: [],
});

function createAgent(def: AgentDef): AgentDef {
  return def;
}
