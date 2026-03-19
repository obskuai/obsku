import type { Checkpoint, CheckpointBackend } from "./checkpoint/index";
import { executeGraph } from "./graph/executor";
import type { ExecuteGraphOptions, Graph, GraphResult } from "./graph/types";
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
  onEvent?: (event: AgentEvent) => void;
  /** Checkpoint to resume from */
  resumeFrom?: Checkpoint;
  /** Session ID for checkpointing */
  sessionId?: string;
}

// --- Main entry point ---

export async function run(graph: Graph, options?: RunOptions): Promise<GraphResult> {
  const onEvent = options?.onEvent ?? graph.onEvent;
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
        resumeFrom: options.resumeFrom,
        sessionId: options.sessionId,
      }
    : undefined;

  try {
    const result = await executeGraph(graph, onEvent, 1, executeOptions);

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
