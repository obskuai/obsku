import { describe, expect, test } from "bun:test";
import { GraphValidationError, graph } from "../../src/graph/builder";
import { executeGraph } from "../../src/graph/executor";
import type { GraphNode } from "../../src/graph/types";
import { makeEdge, makeNode, minimalMockProvider } from "../utils/helpers";

// --- Local Helper (different signature from shared) ---

function fnNode(id: string, fn: () => Promise<unknown>): GraphNode {
  return {
    description: `Node ${id}`,
    executor: async () => fn(),
    id,
  };
}

function fnNode(id: string, fn: () => Promise<unknown>): GraphNode {
  return {
    description: `Node ${id}`,
    executor: async () => fn(),
    id,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("graph() back-edges", () => {
  test("builds graph with back-edge stored separately", () => {
    const nodes = [makeNode("A"), makeNode("B")];
    const edges = [makeEdge("A", "B"), makeEdge("B", "A", { back: true, maxIterations: 2 })];

    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });

    expect(g.edges).toHaveLength(1);
    expect(g.backEdges).toHaveLength(1);
    expect(g.backEdges[0]).toMatchObject({ back: true, from: "B", maxIterations: 2, to: "A" });
    expect(g.executionOrder).toEqual(["A", "B"]);
    expect(g.adjacency.get("A")).toHaveLength(1);
    expect(g.adjacency.get("B")).toHaveLength(0);
  });

  test("rejects back-edge without maxIterations", () => {
    const nodes = [makeNode("A"), makeNode("B")];
    const edges = [makeEdge("A", "B"), makeEdge("B", "A", { back: true })];

    expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
      GraphValidationError
    );
    expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
      /maxIterations/i
    );
  });

  test("keeps backward compatible forward edges", () => {
    const nodes = [makeNode("A"), makeNode("B")];
    const edges = [makeEdge("A", "B")];

    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });

    expect(g.edges).toHaveLength(1);
    expect(g.backEdges).toHaveLength(0);
    expect(g.executionOrder).toEqual(["A", "B"]);
  });

  test("rejects self-edge even when marked back", () => {
    const nodes = [makeNode("A"), makeNode("B")];
    const edges = [makeEdge("A", "B"), makeEdge("A", "A", { back: true, maxIterations: 1 })];

    expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
      GraphValidationError
    );
    expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
      /Self-edge.*"A"/
    );
  });

  test("back-edges do not prevent orphan detection", () => {
    const nodes = [makeNode("A"), makeNode("B"), makeNode("C")];
    const edges = [makeEdge("A", "B"), makeEdge("C", "A", { back: true, maxIterations: 1 })];

    expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
      GraphValidationError
    );
    expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
      /Orphan.*"C"/
    );
  });
});

describe("executeGraph() cycles", () => {
  test("executes 3 iterations for A→B→C with C→A back-edge", async () => {
    const counts = new Map<string, number>();
    const nodes = ["A", "B", "C"].map((id) =>
      fnNode(id, async () => {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        return `${id}-${counts.get(id)}`;
      })
    );
    const edges = [
      makeEdge("A", "B"),
      makeEdge("B", "C"),
      makeEdge("C", "A", { back: true, maxIterations: 3 }),
    ];

    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    expect(counts.get("A")).toBe(4);
    expect(counts.get("B")).toBe(4);
    expect(counts.get("C")).toBe(4);
  });

  test("stops early when until condition is met", async () => {
    let count = 0;
    const nodes = [
      fnNode("A", async () => "start"),
      fnNode("B", async () => {
        count += 1;
        return count;
      }),
    ];
    const edges = [
      makeEdge("A", "B"),
      makeEdge("B", "A", { back: true, maxIterations: 5, until: (result) => result === 2 }),
    ];

    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    expect(count).toBe(2);
  });

  test("back-edge condition gates cycle execution", async () => {
    const counts = new Map<string, number>();
    const nodes = [
      fnNode("A", async () => {
        counts.set("A", (counts.get("A") ?? 0) + 1);
        return "start";
      }),
      fnNode("B", async () => {
        counts.set("B", (counts.get("B") ?? 0) + 1);
        return "no";
      }),
    ];
    const edges = [
      makeEdge("A", "B"),
      makeEdge("B", "A", {
        back: true,
        condition: (result) => result === "yes",
        maxIterations: 3,
      }),
    ];

    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    expect(counts.get("A")).toBe(1);
    expect(counts.get("B")).toBe(1);
  });

  test("emits graph.cycle.start and graph.cycle.complete events", async () => {
    const events: Array<{ type: string } & Record<string, unknown>> = [];
    const nodes = [fnNode("A", async () => "a"), fnNode("B", async () => "b")];
    const edges = [makeEdge("A", "B"), makeEdge("B", "A", { back: true, maxIterations: 2 })];

    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });
    const result = await executeGraph(g, (event) =>
      events.push(event as { type: string } & Record<string, unknown>)
    );

    expect(result.status).toBe("Complete");
    const starts = events.filter((event) => event.type === "graph.cycle.start");
    const completes = events.filter((event) => event.type === "graph.cycle.complete");
    expect(starts).toHaveLength(2);
    expect(completes).toHaveLength(2);
    expect(starts[0]).toMatchObject({ from: "B", iteration: 1, maxIterations: 2, to: "A" });
    expect(completes[1]).toMatchObject({ from: "B", iteration: 2, maxIterations: 2, to: "A" });
  });

  test("fails fast when a cycle node fails", async () => {
    let count = 0;
    const nodes = [
      fnNode("A", async () => "ok"),
      fnNode("B", async () => {
        count += 1;
        if (count === 2) {
          throw new Error("boom");
        }
        return `run-${count}`;
      }),
    ];
    const edges = [makeEdge("A", "B"), makeEdge("B", "A", { back: true, maxIterations: 3 })];

    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });
    const result = await executeGraph(g);

    expect(result.status).toBe("Failed");
    expect(result.results.B.status).toBe("Failed");
    expect(count).toBe(2);
  });

  test("mixed DAG + cycle executes correctly", async () => {
    const counts = new Map<string, number>();
    const nodes = ["A", "B", "C", "D"].map((id) =>
      fnNode(id, async () => {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        return `${id}-${counts.get(id)}`;
      })
    );
    const edges = [
      makeEdge("A", "B"),
      makeEdge("B", "C"),
      makeEdge("A", "D"),
      makeEdge("C", "A", { back: true, maxIterations: 2 }),
    ];

    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    expect(counts.get("D")).toBe(1);
    expect(counts.get("A")).toBe(3);
    expect(counts.get("B")).toBe(3);
    expect(counts.get("C")).toBe(3);
  });
});
