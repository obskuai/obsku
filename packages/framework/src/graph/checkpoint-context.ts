import { type InterruptError, isInterruptError } from "../interrupt/types";
import type { AgentEvent } from "../types";
import { saveCompletionCheckpoint, saveInterruptCheckpoint } from "./checkpoint-utils";
import type { ExecutionContext, InterruptedPhaseResult } from "./graph-executor-types";
import type { ExecuteGraphOptions, NodeResult } from "./types";

export type SaveCheckpointExtra =
  | {
      allNodeIds: Array<string>;
      cycleState?: { backEdge: string; iteration: number };
      interruptError: InterruptError;
      nodeId: string;
      onCheckpoint?: ExecuteGraphOptions["onCheckpoint"];
      onEvent?: (event: AgentEvent) => void;
      results: Map<string, NodeResult>;
      type: "interrupt";
    }
  | {
      allNodeIds: Array<string>;
      cycleState?: { backEdge: string; iteration: number };
      onCheckpoint?: ExecuteGraphOptions["onCheckpoint"];
      onEvent?: (event: AgentEvent) => void;
      results: Map<string, NodeResult>;
      type: "completion";
    };

export async function saveCheckpointIfEnabled(
  store: ExecuteGraphOptions["checkpointStore"],
  sessionId: ExecuteGraphOptions["sessionId"],
  namespace: string,
  step: number,
  extra?: SaveCheckpointExtra
): Promise<void> {
  if (!store || !sessionId || !extra) {
    return;
  }

  if (extra.type === "interrupt") {
    await saveInterruptCheckpoint({
      allNodeIds: extra.allNodeIds,
      cycleState: extra.cycleState,
      interruptError: extra.interruptError,
      namespace,
      nodeId: extra.nodeId,
      onCheckpoint: extra.onCheckpoint,
      onEvent: extra.onEvent,
      results: extra.results,
      sessionId,
      step,
      store,
    });
    return;
  }

  await saveCompletionCheckpoint({
    allNodeIds: extra.allNodeIds,
    cycleState: extra.cycleState,
    namespace,
    onCheckpoint: extra.onCheckpoint,
    onEvent: extra.onEvent,
    results: extra.results,
    sessionId,
    step,
    store,
  });
}

export type CheckpointPayloadOverrides =
  | {
      cycleState?: { backEdge: string; iteration: number };
      interruptError: InterruptError;
      nodeId: string;
      onEvent?: (event: AgentEvent) => void;
      type: "interrupt";
    }
  | {
      cycleState?: { backEdge: string; iteration: number };
      onEvent?: (event: AgentEvent) => void;
      type: "completion";
    };

function buildCheckpointPayload(
  ctx: ExecutionContext,
  overrides: CheckpointPayloadOverrides
): SaveCheckpointExtra {
  return {
    ...overrides,
    allNodeIds: Array.from(ctx.graph.nodes.keys()),
    onCheckpoint: ctx.options?.onCheckpoint,
    results: ctx.results,
  } as SaveCheckpointExtra;
}

export async function saveCheckpointFromContext(
  ctx: ExecutionContext,
  step: number,
  overrides: CheckpointPayloadOverrides
): Promise<void> {
  await saveCheckpointIfEnabled(
    ctx.options?.checkpointStore,
    ctx.options?.sessionId,
    ctx.options?.namespace ?? "",
    step,
    buildCheckpointPayload(ctx, overrides)
  );
}

export interface InterruptCheckpointStrategyOptions {
  cycleState?: { backEdge: string; iteration: number };
  getNodeId: () => string | null;
  step: number;
  swallowCheckpointSaveError?: boolean;
}

export async function withInterruptCheckpoint<T>(
  ctx: ExecutionContext,
  run: () => Promise<T>,
  options: InterruptCheckpointStrategyOptions
): Promise<T | InterruptedPhaseResult> {
  try {
    return await run();
  } catch (error: unknown) {
    const nodeId = options.getNodeId();
    if (!isInterruptError(error) || !nodeId) {
      throw error;
    }

    try {
      await saveCheckpointFromContext(ctx, options.step, {
        ...(options.cycleState ? { cycleState: options.cycleState } : {}),
        interruptError: error,
        nodeId,
        onEvent: ctx.onEvent,
        type: "interrupt",
      });
    } catch (checkpointError: unknown) {
      if (!options.swallowCheckpointSaveError) {
        throw checkpointError;
      }
    }

    return { nodeId, status: "Interrupted" };
  }
}
