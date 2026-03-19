import { graph } from "../graph/builder";
import type { Graph, GraphEdge, GraphNode } from "../graph/types";
import type { AgentDef, LLMProvider } from "../types";
import { MultiAgentConfigError } from "./errors";
import { supervisor } from "./supervisor";

export interface CrewMember {
  agent: AgentDef;
  task: string;
}

export interface CrewConfig {
  members: Array<CrewMember>;
  name: string;
  process: "sequential" | "hierarchical";
  provider: LLMProvider;
}

export function crew(config: CrewConfig): Graph {
  if (config.members.length === 0) {
    throw new MultiAgentConfigError("Empty crew");
  }

  if (config.process === "sequential") {
    const nodes: Array<GraphNode> = config.members.map((member) => ({
      executor: {
        ...member.agent,
        prompt: `Task: ${member.task}\n\n${member.agent.prompt}`,
      },
      id: member.agent.name,
    }));

    const edges: Array<GraphEdge> = [];
    for (let i = 0; i < config.members.length - 1; i++) {
      edges.push({
        from: config.members[i].agent.name,
        to: config.members[i + 1].agent.name,
      });
    }

    return graph({
      edges,
      entry: config.members[0].agent.name,
      nodes,
      provider: config.provider,
    });
  }

  return supervisor({
    maxRounds: config.members.length * 2,
    name: `${config.name}-manager`,
    provider: config.provider,
    workers: config.members.map((m) => m.agent),
  });
}
