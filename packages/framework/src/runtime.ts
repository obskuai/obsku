import type { Checkpoint, CheckpointBackend } from "./checkpoint/index";
import { executeGraph } from "./graph/executor";
import type { ExecuteGraphOptions, Graph, GraphResult } from "./graph/types";
import type { DefaultPublicPayload } from "./output-policy";
import { loadOutputPolicy, wrapCallback } from "./output-policy";
import type { AgentEvent } from "./types";

// --- Run Options ---

export interface RunOptions {
  /** Checkpoint store for session persistence */
  checkpointStore?: CheckpointBackend;
  /** Input to the graph entry node */
  input?: string;
  /** Namespace for checkpointing */
  namespace?: string;
  /** Callback when checkpoint is saved */
  onCheckpoint?: (checkpoint: Checkpoint) => void;
  /** Event handler for graph execution events */
  onEvent?: (event: DefaultPublicPayload<AgentEvent>) => void;
  /** Checkpoint to resume from */
  resumeFrom?: Checkpoint;
  /** Session ID for checkpointing */
  sessionId?: string;
}

// --- Main entry point ---

export async function run(graph: Graph, options?: RunOptions): Promise<GraphResult> {
  const loadedPolicy = loadOutputPolicy();
  const policy = loadedPolicy.createPolicy();
  const publicOnEvent = options?.onEvent ?? graph.onEvent;
  const onEvent = publicOnEvent ? wrapCallback(publicOnEvent, policy, "callback") : undefined;
  const sessionId = options?.sessionId;

  onEvent?.({
    input: options?.input,
    sessionId,
    timestamp: Date.now(),
    type: "session.start",
  });

  const executeOptions: ExecuteGraphOptions | undefined = options
    ? {
        checkpointStore: options.checkpointStore,
        input: options.input,
        namespace: options.namespace,
        onCheckpoint: options.onCheckpoint,
        outputPolicy: loadedPolicy,
        resumeFrom: options.resumeFrom,
        sessionId: options.sessionId,
      }
    : { outputPolicy: loadedPolicy };

  try {
    const result = await executeGraph(graph, publicOnEvent, 1, executeOptions);

    const status =
      result.status === "Complete"
        ? "complete"
        : result.status === "Interrupted"
          ? "interrupted"
          : "failed";

    onEvent?.({
      sessionId,
      status,
      timestamp: Date.now(),
      type: "session.end",
    });

    return result;
  } catch (error: unknown) {
    onEvent?.({
      sessionId,
      status: "failed",
      timestamp: Date.now(),
      type: "session.end",
    });
    throw error;
  }
}
