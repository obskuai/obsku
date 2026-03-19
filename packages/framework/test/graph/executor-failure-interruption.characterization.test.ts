import { describe, expect, test } from "bun:test";
import { graph } from "../../src/graph/builder";
import { GraphNestingError } from "../../src/graph/errors";
import { executeGraph } from "../../src/graph/executor";
import type { GraphNode } from "../../src/graph/types";
import { InterruptError, interrupt } from "../../src/interrupt/types";
import { minimalMockProvider } from "../utils/helpers";

function successNode(id: string): GraphNode {
  return { executor: async () => "ok", id };
}

function successNode(id: string): GraphNode {
  return { executor: async () => "ok", id };
}

function failingNode(id: string, message: string): GraphNode {
  return {
    executor: async () => {
      throw new Error(message);
    },
    id,
  };
}

function interruptingNode(id: string, reason: string): GraphNode {
  return {
    executor: async () => {
      interrupt({ reason });
    },
    id,
  };
}

function nestingErrorNode(id: string): GraphNode {
  return {
    executor: async () => {
      throw new GraphNestingError(10);
    },
    id,
  };
}

describe("graph executor failure/interruption characterization", () => {
  test("node throwing a plain Error → graph returns Failed status", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [failingNode("A", "node exploded")],
      provider: minimalMockProvider,
    });

    const result = await executeGraph(g, undefined, 1);

    expect(result.status).toBe("Failed");
    expect(result.results.A).toBeDefined();
    expect(result.results.A.status).toBe("Failed");
  });

  test("node throwing plain Error → error message preserved in graph result", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [failingNode("A", "boom-message")],
      provider: minimalMockProvider,
    });

    const result = await executeGraph(g, undefined, 1);

    expect(result.status).toBe("Failed");
    expect(result.error).toBeDefined();
    const errStr = JSON.stringify(result.error);
    expect(errStr).toContain("boom-message");
  });

  test("downstream node not executed after upstream node fails", async () => {
    const executed: Array<string> = [];
    const g = graph({
      edges: [{ from: "A", to: "B" }],
      entry: "A",
      nodes: [
        {
          executor: async () => {
            executed.push("A");
            throw new Error("A failed");
          },
          id: "A",
        },
        {
          executor: async () => {
            executed.push("B");
            return "B done";
          },
          id: "B",
        },
      ],
      provider: minimalMockProvider,
    });

    const result = await executeGraph(g, undefined, 1);

    expect(result.status).toBe("Failed");
    expect(executed).toContain("A");
    expect(executed).not.toContain("B");
  });

  test("GraphNestingError is re-thrown (NOT caught as a normal failure)", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [nestingErrorNode("A")],
      provider: minimalMockProvider,
    });

    await expect(executeGraph(g, undefined, 1)).rejects.toBeInstanceOf(GraphNestingError);
  });

  test("InterruptError in a node → graph returns Interrupted status", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [interruptingNode("A", "needs approval")],
      provider: minimalMockProvider,
    });

    const result = await executeGraph(g, undefined, 1);

    expect(result.status).toBe("Interrupted");
    expect(result.results).toBeDefined();
  });

  test("Interrupted result has no error field (interruption is not a failure)", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [interruptingNode("A", "pause for review")],
      provider: minimalMockProvider,
    });

    const result = await executeGraph(g, undefined, 1);

    expect(result.status).toBe("Interrupted");
    expect((result as { error?: unknown }).error).toBeUndefined();
  });

  test("successful graph returns Complete with all node results", async () => {
    const g = graph({
      edges: [{ from: "A", to: "B" }],
      entry: "A",
      nodes: [successNode("A"), successNode("B")],
      provider: minimalMockProvider,
    });

    const result = await executeGraph(g, undefined, 1);

    expect(result.status).toBe("Complete");
    expect(result.results.A.status).toBe("Complete");
    expect(result.results.B.status).toBe("Complete");
  });

  test("failure in second wave node → Failed status with partial results", async () => {
    const g = graph({
      edges: [{ from: "A", to: "B" }],
      entry: "A",
      nodes: [successNode("A"), failingNode("B", "B crashed")],
      provider: minimalMockProvider,
    });

    const result = await executeGraph(g, undefined, 1);

    expect(result.status).toBe("Failed");
    expect(result.results.A.status).toBe("Complete");
    expect(result.results.B.status).toBe("Failed");
  });

  test("outer catch returns Failed for non-GraphNestingError thrown outside wave", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [failingNode("A", "outer error test")],
      provider: minimalMockProvider,
    });

    const result = await executeGraph(g, undefined, 1);

    expect(result.status).toBe("Failed");
    expect(result.error).not.toBeUndefined();
  });

  test("InterruptError message is preserved as reason in the interrupt config", () => {
    let caughtError: unknown;
    try {
      interrupt({ reason: "test interrupt reason" });
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(InterruptError);
    if (caughtError instanceof InterruptError) {
      expect(caughtError.config.reason).toBe("test interrupt reason");
    }
  });
});
