// =============================================================================
// @obsku/framework — Node-level graph execution
// =============================================================================

import { isInterruptError } from "../interrupt/types";
import type { AgentEvent, LLMProvider } from "../types";
import { getErrorMessage } from "../utils";
import { GraphNestingError } from "./errors";
import { executeAgentNode } from "./node-execution/agent-node";
import { executeFunctionNode } from "./node-execution/function-node";
import { executeSubgraphNode } from "./node-execution/subgraph-node";
import type { ExecuteGraphOptions, Graph, GraphNode, NodeResult } from "./types";
import { isAgentDef, isGraph, makeGraphFailureEnvelope } from "./types";

export { extractText } from "./node-execution/text";

export function buildNodeInput(
  nodeId: string,
  results: ReadonlyMap<string, NodeResult>,
  graph: Graph
): string {
  const depOutputs: Array<string> = [];

  for (const edge of graph.edges) {
    if (edge.to !== nodeId) {
      continue;
    }

    const depResult = results.get(edge.from);
    if (!depResult) {
      continue;
    }

    if (edge.condition && !edge.condition(depResult.output)) {
      continue;
    }

    depOutputs.push(String(depResult.output));
  }

  return depOutputs.join("\n\n");
}

export async function executeNode(
  node: GraphNode,
  input: string,
  provider: LLMProvider,
  onEvent?: (event: AgentEvent) => void,
  depth = 1,
  options?: ExecuteGraphOptions
): Promise<NodeResult> {
  const start = Date.now();

  try {
    const outcome = isAgentDef(node.executor)
      ? await executeAgentNode(node.executor, { input, onEvent, options, provider })
      : isGraph(node.executor)
        ? await executeSubgraphNode(node.executor, {
            depth,
            nodeId: node.id,
            onEvent,
            options,
            provider,
          })
        : await executeFunctionNode(node.executor, input);

    if (outcome.kind === "failed") {
      return {
        duration: Date.now() - start,
        output: outcome.output,
        status: "Failed",
      };
    }

    return {
      duration: Date.now() - start,
      output: outcome.output,
      status: "Complete",
    };
  } catch (error: unknown) {
    if (isInterruptError(error)) {
      throw error;
    }
    if (error instanceof GraphNestingError) {
      throw error;
    }
    return {
      duration: Date.now() - start,
      output: makeGraphFailureEnvelope(getErrorMessage(error)),
      status: "Failed",
    };
  }
}
