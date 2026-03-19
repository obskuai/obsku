import { saveCheckpointFromContext, withInterruptCheckpoint } from "./checkpoint-context";
import type { ExecutionContext, ExecutionPhaseResult } from "./graph-executor-types";
import { collectReachable, collectReverseReachable } from "./graph-traversal";
import { buildNodeInput } from "./node-executor";
import type { Graph, GraphEdge } from "./types";
import { executeSingleNode } from "./wave-executor";

type CycleIterationResult = ExecutionPhaseResult | { status: "Break" };

function toAdjacencyList(
  reverseAdjacency: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, Array<string>> {
  const reverseAdjacencyList = new Map<string, Array<string>>();

  for (const [nodeId, parents] of reverseAdjacency) {
    reverseAdjacencyList.set(nodeId, [...parents]);
  }

  return reverseAdjacencyList;
}

function getCycleNodes(
  graph: Graph,
  backEdge: GraphEdge,
  reverseAdjacencyList: ReadonlyMap<string, ReadonlyArray<string>>
): Array<string> {
  const forwardReachable = collectReachable(backEdge.to, graph.adjacency);
  const reverseReachable = collectReverseReachable(backEdge.from, reverseAdjacencyList);

  return graph.executionOrder.filter(
    (nodeId: string) => forwardReachable.has(nodeId) && reverseReachable.has(nodeId)
  );
}

function shouldRunCycleIteration(ctx: ExecutionContext, backEdge: GraphEdge): boolean {
  const fromResult = ctx.results.get(backEdge.from);
  if (!fromResult) {
    return false;
  }

  return !backEdge.condition || backEdge.condition(fromResult.output);
}

function emitCycleEvent(
  ctx: ExecutionContext,
  type: "graph.cycle.start" | "graph.cycle.complete",
  backEdge: GraphEdge,
  iteration: number,
  maxIterations: number
): void {
  ctx.onEvent?.({
    from: backEdge.from,
    iteration,
    maxIterations,
    timestamp: Date.now(),
    to: backEdge.to,
    type,
  });
}

export async function executeCycleIteration(
  ctx: ExecutionContext,
  backEdge: GraphEdge,
  cycleNodes: Array<string>,
  cycleGraph: Graph,
  iteration: number
): Promise<CycleIterationResult> {
  const cycleState = {
    backEdge: `${backEdge.from}->${backEdge.to}`,
    iteration,
  };

  for (const nodeId of cycleNodes) {
    const nodeInput = buildCycleInput(nodeId, ctx, cycleGraph);
    const resultOrInterrupted = await withInterruptCheckpoint(
      ctx,
      async () => {
        const { result } = await executeSingleNode(ctx, nodeId, nodeInput, ctx.onEvent);
        return result;
      },
      {
        cycleState,
        getNodeId: () => nodeId,
        step: iteration,
      }
    );

    if ("status" in resultOrInterrupted && resultOrInterrupted.status === "Interrupted") {
      return resultOrInterrupted;
    }

    const result = resultOrInterrupted;

    ctx.results.set(nodeId, result);

    if (result.status === "Failed") {
      return { status: "Failed" };
    }
  }

  await saveCheckpointFromContext(ctx, iteration, {
    cycleState,
    onEvent: ctx.onEvent,
    type: "completion",
  });

  emitCycleEvent(ctx, "graph.cycle.complete", backEdge, iteration, backEdge.maxIterations ?? 0);

  const updatedFromResult = ctx.results.get(backEdge.from);
  if (backEdge.until && updatedFromResult && backEdge.until(updatedFromResult.output)) {
    return { status: "Break" };
  }

  return { status: "Complete" };
}

export async function executeBackEdgeCycles(
  ctx: ExecutionContext,
  reverseAdjacency: Map<string, Set<string>>
): Promise<ExecutionPhaseResult> {
  const { graph, onEvent, results: _results } = ctx;
  const reverseAdjacencyList = toAdjacencyList(reverseAdjacency);

  if (graph.backEdges.length === 0) {
    return { status: "Complete" };
  }

  for (const backEdge of graph.backEdges) {
    const maxIterations = backEdge.maxIterations ?? 0;
    if (maxIterations <= 0) {
      continue;
    }

    const cycleNodes = getCycleNodes(graph, backEdge, reverseAdjacencyList);

    if (cycleNodes.length === 0) {
      continue;
    }

    const cycleGraph: Graph = { ...graph, edges: [...graph.edges, backEdge] };

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      if (!shouldRunCycleIteration(ctx, backEdge)) {
        break;
      }

      if (onEvent) {
        emitCycleEvent(ctx, "graph.cycle.start", backEdge, iteration, maxIterations);
      }

      const iterResult = await executeCycleIteration(
        ctx,
        backEdge,
        cycleNodes,
        cycleGraph,
        iteration
      );

      if (iterResult.status === "Failed" || iterResult.status === "Interrupted") {
        return iterResult;
      }

      if (iterResult.status === "Break") {
        break;
      }
    }
  }

  return { status: "Complete" };
}

function buildCycleInput(nodeId: string, ctx: ExecutionContext, cycleGraph: Graph): string {
  return buildNodeInput(nodeId, ctx.results, cycleGraph);
}
