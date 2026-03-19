import { isInterruptError } from "../interrupt/types";
import type { AgentEvent } from "../types";
import { saveCheckpointFromContext, withInterruptCheckpoint } from "./checkpoint-context";
import { NodeNotFoundError } from "./errors";
import type { ExecutionContext, ExecutionPhaseResult } from "./graph-executor-types";
import { buildNodeInput, executeNode } from "./node-executor";
import type { GraphEdge, NodeResult } from "./types";
import { getGraphFailureError } from "./types";

function shouldSkipNode(
  nodeId: string,
  results: ReadonlyMap<string, NodeResult>,
  edges: ReadonlyArray<GraphEdge>
): boolean {
  const incomingEdges = edges.filter((e) => e.to === nodeId);

  if (incomingEdges.length === 0) {
    return false;
  }

  const hasUnconditionalEdge = incomingEdges.some((e) => !e.condition);
  if (hasUnconditionalEdge) {
    return false;
  }

  const anyConditionTrue = incomingEdges.some((e) => {
    const depResult = results.get(e.from);
    return depResult && depResult.status !== "Skipped" && e.condition!(depResult.output);
  });

  return !anyConditionTrue;
}

export async function executeSingleNode(
  ctx: ExecutionContext,
  nodeId: string,
  nodeInput: string,
  onEvent?: (event: AgentEvent) => void
): Promise<{ nodeId: string; result: NodeResult }> {
  const node = ctx.graph.nodes.get(nodeId);
  if (!node) {
    throw new NodeNotFoundError(nodeId);
  }

  const startTime = Date.now();
  if (onEvent) {
    onEvent({ nodeId, timestamp: startTime, type: "graph.node.start" });
  }

  const result = await executeNode(
    node,
    nodeInput,
    ctx.graph.provider,
    onEvent,
    ctx.depth,
    ctx.options
  );

  if (onEvent) {
    const timestamp = Date.now();
    if (result.status === "Complete") {
      onEvent({
        duration: Date.now() - startTime,
        nodeId,
        result: result.output,
        timestamp,
        type: "graph.node.complete",
      });
    } else {
      onEvent({
        error: getGraphFailureError(result.output),
        nodeId,
        timestamp,
        type: "graph.node.failed",
      });
    }
  }

  return { nodeId, result };
}

function getPendingWaveNodes(ctx: ExecutionContext, wave: ReadonlyArray<string>): Array<string> {
  if (!ctx.options?.resumeFrom) {
    return [...wave];
  }

  return wave.filter((nodeId) => !ctx.results.has(nodeId));
}

function markSkippedWaveNodes(
  ctx: ExecutionContext,
  pendingWaveNodes: ReadonlyArray<string>
): Array<string> {
  const nodesToExecute: Array<string> = [];

  for (const nodeId of pendingWaveNodes) {
    if (shouldSkipNode(nodeId, ctx.results, ctx.graph.edges)) {
      ctx.results.set(nodeId, {
        duration: 0,
        output: undefined,
        status: "Skipped",
      });
      continue;
    }

    nodesToExecute.push(nodeId);
  }

  return nodesToExecute;
}

function getWaveNodeInput(ctx: ExecutionContext, nodeId: string, entryInput: unknown): string {
  if (nodeId === ctx.graph.entry && entryInput !== undefined) {
    return String(entryInput);
  }

  return buildNodeInput(nodeId, ctx.results, ctx.graph);
}

async function executeWaveNodes(
  ctx: ExecutionContext,
  nodesToExecute: ReadonlyArray<string>,
  waveIndex: number,
  entryInput: unknown
): Promise<ExecutionPhaseResult> {
  let interruptedNodeId: string | null = null;
  const interruptedResult = await withInterruptCheckpoint(
    ctx,
    async (): Promise<ExecutionPhaseResult | null> => {
      const waveResults = await Promise.all(
        nodesToExecute.map(async (nodeId) => {
          try {
            return await executeSingleNode(
              ctx,
              nodeId,
              getWaveNodeInput(ctx, nodeId, entryInput),
              ctx.onEvent
            );
          } catch (error: unknown) {
            if (isInterruptError(error)) {
              interruptedNodeId = nodeId;
            }
            throw error;
          }
        })
      );

      for (const { nodeId, result } of waveResults) {
        ctx.results.set(nodeId, result);

        if (result.status === "Failed") {
          return { status: "Failed" };
        }
      }
      return null;
    },
    {
      getNodeId: () => interruptedNodeId,
      step: waveIndex,
      swallowCheckpointSaveError: true,
    }
  );

  if (interruptedResult) {
    return interruptedResult;
  }

  await saveCheckpointFromContext(ctx, waveIndex, { onEvent: ctx.onEvent, type: "completion" });
  return { status: "Complete" };
}

export async function executeWave(
  ctx: ExecutionContext,
  wave: Array<string>,
  waveIndex: number
): Promise<ExecutionPhaseResult> {
  const entryInput = waveIndex === 0 ? ctx.options?.input : undefined;
  const pendingWaveNodes = getPendingWaveNodes(ctx, wave);

  if (pendingWaveNodes.length === 0) {
    return { status: "Complete" };
  }

  const nodesToExecute = markSkippedWaveNodes(ctx, pendingWaveNodes);

  if (nodesToExecute.length === 0) {
    return { status: "Complete" };
  }

  return executeWaveNodes(ctx, nodesToExecute, waveIndex, entryInput);
}
