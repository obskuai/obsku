import type { DefaultPublicPayload } from "../../output-policy";
import type { AgentEvent, LLMProvider } from "../../types";
import { GraphNestingError } from "../errors";
import { executeGraph } from "../executor";
import type { ExecuteGraphOptions, Graph } from "../types";
import { MAX_GRAPH_DEPTH, makeGraphFailureEnvelope } from "../types";
import { completeNodeExecution, failedNodeExecution, type NodeExecutionOutcome } from "./types";

interface ExecuteSubgraphNodeOptions {
  readonly depth: number;
  readonly nodeId: string;
  readonly onEvent?: (event: AgentEvent) => void;
  readonly options?: ExecuteGraphOptions;
  readonly provider: LLMProvider;
}

export async function executeSubgraphNode(
  executor: Graph,
  { depth, nodeId, onEvent, options, provider }: ExecuteSubgraphNodeOptions
): Promise<NodeExecutionOutcome> {
  if (depth >= MAX_GRAPH_DEPTH) {
    throw new GraphNestingError(MAX_GRAPH_DEPTH);
  }

  const eventHandler = (event: DefaultPublicPayload<AgentEvent>) => {
    const canonicalEvent = {
      ...event.data,
      timestamp: event.timestamp,
      type: event.type,
    } as AgentEvent;

    executor.onEvent?.(event);
    onEvent?.(canonicalEvent);
  };

  const subgraphOptions: ExecuteGraphOptions | undefined =
    options?.checkpointStore && options?.sessionId
      ? {
          checkpointStore: options.checkpointStore,
          namespace: nodeId,
          onCheckpoint: options.onCheckpoint,
          outputPolicy: options.outputPolicy,
          sessionId: options.sessionId,
        }
      : undefined;

  const subgraphResult = await executeGraph(
    { ...executor, provider },
    eventHandler,
    depth + 1,
    subgraphOptions
  );
  if (subgraphResult.status === "Failed") {
    return failedNodeExecution(
      makeGraphFailureEnvelope(subgraphResult.error.error, subgraphResult)
    );
  }

  return completeNodeExecution(subgraphResult);
}
