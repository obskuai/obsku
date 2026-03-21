import type { DefaultPublicPayload } from "../output-policy";
import { loadOutputPolicy, wrapCallback } from "../output-policy";
import type { LoadedPolicy } from "../output-policy/loader";
import type { AgentEvent } from "../types";
import { getErrorMessage } from "../utils";
import {
  getRestoredCheckpointGraphResult,
  makeCompleteGraphResult,
  makeFailedGraphResult,
  makeInterruptedGraphResult,
  restoreCheckpointNodeResults,
} from "./checkpoint-restoration";
import { executeBackEdgeCycles } from "./cycle-executor";
import { GraphNestingError } from "./errors";
import type { ExecutionContext, ExecutionPhaseResult } from "./graph-executor-types";
import { buildReverseAdjacency } from "./graph-traversal";
import { toposort } from "./toposort";
import type { ExecuteGraphOptions, Graph, GraphResult, NodeResult } from "./types";
import { makeGraphFailureEnvelope } from "./types";
import { executeWave } from "./wave-executor";

function toGraphResult(
  ctx: ExecutionContext,
  phaseResult: ExecutionPhaseResult,
  failedFallback: string
): GraphResult {
  if (phaseResult.status === "Failed") {
    return makeFailedGraphResult(ctx.results, failedFallback);
  }

  if (phaseResult.status === "Interrupted") {
    return makeInterruptedGraphResult(ctx.results);
  }

  return makeCompleteGraphResult(ctx.results);
}

async function executeGraphPhases(
  ctx: ExecutionContext,
  waves: Array<Array<string>>,
  reverseAdjacency: Map<string, Set<string>>
): Promise<{ fallback: string; result: ExecutionPhaseResult }> {
  for (let waveIndex = 0; waveIndex < waves.length; waveIndex += 1) {
    const waveResult = await executeWave(ctx, waves[waveIndex], waveIndex);
    if (waveResult.status !== "Complete") {
      return { fallback: "Graph execution failed", result: waveResult };
    }
  }

  return {
    fallback: "Graph cycle execution failed",
    result: await executeBackEdgeCycles(ctx, reverseAdjacency),
  };
}

export async function executeGraph(
  graph: Graph,
  onEvent?: (event: DefaultPublicPayload<AgentEvent>) => void,
  depth = 1,
  options?: ExecuteGraphOptions
): Promise<GraphResult> {
  const loadedPolicy: LoadedPolicy = options?.outputPolicy ?? loadOutputPolicy();
  const wrappedOnEvent = onEvent
    ? wrapCallback(onEvent, loadedPolicy.createPolicy(), "callback")
    : undefined;
  const waves = toposort(graph);
  const results = new Map<string, NodeResult>();
  const reverseAdjacency = new Map<string, Set<string>>();
  for (const [nodeId, parents] of buildReverseAdjacency(graph.nodes.keys(), graph.edges)) {
    reverseAdjacency.set(nodeId, new Set(parents));
  }

  try {
    const restoredCheckpoint = restoreCheckpointNodeResults(results, options?.resumeFrom);
    const restoredResult = getRestoredCheckpointGraphResult(results, restoredCheckpoint);
    if (restoredResult) {
      return restoredResult;
    }

    const ctx: ExecutionContext = {
      depth,
      graph,
      onEvent: wrappedOnEvent,
      options,
      results,
    };

    const phaseResult = await executeGraphPhases(ctx, waves, reverseAdjacency);
    return toGraphResult(ctx, phaseResult.result, phaseResult.fallback);
  } catch (error: unknown) {
    if (error instanceof GraphNestingError) {
      throw error;
    }
    return {
      error: makeGraphFailureEnvelope(getErrorMessage(error)),
      results: Object.fromEntries(results),
      status: "Failed",
    };
  }
}
