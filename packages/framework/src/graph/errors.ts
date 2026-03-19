import { createTaggedError } from "../errors/tagged-error";

export class NodeNotFoundError extends createTaggedError("NodeNotFoundError") {
  constructor(nodeId: string) {
    super(`Node "${nodeId}" not found in graph`);
  }
}

export class GraphCheckpointNotFoundError extends createTaggedError(
  "GraphCheckpointNotFoundError"
) {
  constructor(checkpointId: string) {
    super(`Checkpoint not found: ${checkpointId}`);
  }
}

export class GraphNestingError extends createTaggedError("GraphNestingError") {
  constructor(depth: number) {
    super(`Max graph nesting depth exceeded (${depth})`);
  }
}

export class GraphCycleError extends createTaggedError("GraphCycleError") {
  constructor(public readonly nodes: Array<string>) {
    super(`Cycle detected involving nodes: ${nodes.map((nodeId) => `"${nodeId}"`).join(", ")}`);
  }
}
