import { describe, expect, it } from "bun:test";
import {
  GraphCheckpointNotFoundError,
  GraphCycleError,
  NodeNotFoundError,
} from "../../src/graph/errors";

describe("NodeNotFoundError", () => {
  it("should extend Error", () => {
    const error = new NodeNotFoundError("node-1");
    expect(error).toBeInstanceOf(Error);
  });

  it("should be instanceof NodeNotFoundError", () => {
    const error = new NodeNotFoundError("node-1");
    expect(error).toBeInstanceOf(NodeNotFoundError);
  });

  it("should have correct _tag", () => {
    const error = new NodeNotFoundError("node-1");
    expect(error._tag).toBe("NodeNotFoundError");
  });

  it("should have correct name", () => {
    const error = new NodeNotFoundError("node-1");
    expect(error.name).toBe("NodeNotFoundError");
  });

  it("should format message with node id", () => {
    const error = new NodeNotFoundError("node-1");
    expect(error.message).toBe('Node "node-1" not found in graph');
  });

  it("should contain 'not found in graph' substring for test compatibility", () => {
    const error = new NodeNotFoundError("xyz-123");
    expect(() => {
      throw error;
    }).toThrow("not found in graph");
  });
});

describe("GraphCheckpointNotFoundError", () => {
  it("should extend Error", () => {
    const error = new GraphCheckpointNotFoundError("cp-1");
    expect(error).toBeInstanceOf(Error);
  });

  it("should be instanceof GraphCheckpointNotFoundError", () => {
    const error = new GraphCheckpointNotFoundError("cp-1");
    expect(error).toBeInstanceOf(GraphCheckpointNotFoundError);
  });

  it("should have correct _tag", () => {
    const error = new GraphCheckpointNotFoundError("cp-1");
    expect(error._tag).toBe("GraphCheckpointNotFoundError");
  });

  it("should have correct name", () => {
    const error = new GraphCheckpointNotFoundError("cp-1");
    expect(error.name).toBe("GraphCheckpointNotFoundError");
  });

  it("should format message with checkpoint id", () => {
    const error = new GraphCheckpointNotFoundError("cp-123");
    expect(error.message).toBe("Checkpoint not found: cp-123");
  });

  it("should contain 'Checkpoint not found' substring for test compatibility", () => {
    const error = new GraphCheckpointNotFoundError("cp-xyz");
    expect(() => {
      throw error;
    }).toThrow("Checkpoint not found");
  });
});

describe("GraphCycleError", () => {
  it("should extend Error", () => {
    const error = new GraphCycleError(["A", "B"]);
    expect(error).toBeInstanceOf(Error);
  });

  it("should be instanceof GraphCycleError", () => {
    const error = new GraphCycleError(["A", "B"]);
    expect(error).toBeInstanceOf(GraphCycleError);
  });

  it("should have correct _tag", () => {
    const error = new GraphCycleError(["A", "B"]);
    expect(error._tag).toBe("GraphCycleError");
  });

  it("should have correct name", () => {
    const error = new GraphCycleError(["A", "B"]);
    expect(error.name).toBe("GraphCycleError");
  });

  it("should format message with node names", () => {
    const error = new GraphCycleError(["A", "B"]);
    expect(error.message).toBe('Cycle detected involving nodes: "A", "B"');
  });

  it("should contain 'Cycle detected' substring for test compatibility", () => {
    const error = new GraphCycleError(["X", "Y", "Z"]);
    expect(() => {
      throw error;
    }).toThrow("Cycle detected");
  });

  it("should expose nodes array", () => {
    const error = new GraphCycleError(["A", "B", "C"]);
    expect(error.nodes).toEqual(["A", "B", "C"]);
  });
});
