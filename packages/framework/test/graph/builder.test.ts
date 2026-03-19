import { describe, expect, test } from "bun:test";
import { GraphValidationError, graph } from "../../src/graph/builder";
import type { GraphEdge, GraphNode } from "../../src/graph/types";
import { DEFAULT_GRAPH_CONFIG } from "../../src/graph/types";
import { makeEdge, makeNode, minimalMockProvider } from "../utils/helpers";

// =============================================================================
// Tests
// =============================================================================

// =============================================================================
// Tests
// =============================================================================

describe("graph()", () => {
  describe("valid graphs", () => {
    test("builds a linear 3-node graph", () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C")];
      const edges = [makeEdge("A", "B"), makeEdge("B", "C")];

      const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });

      expect(g.entry).toBe("A");
      expect(g.nodes.size).toBe(3);
      expect(g.edges).toHaveLength(2);
      expect(g.executionOrder).toEqual(["A", "B", "C"]);
      expect(g.config).toEqual(DEFAULT_GRAPH_CONFIG);
    });

    test("builds a diamond graph (A→B, A→C, B→D, C→D)", () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C"), makeNode("D")];
      const edges = [
        makeEdge("A", "B"),
        makeEdge("A", "C"),
        makeEdge("B", "D"),
        makeEdge("C", "D"),
      ];

      const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });

      expect(g.nodes.size).toBe(4);
      // A must come first, D must come last
      expect(g.executionOrder[0]).toBe("A");
      expect(g.executionOrder.at(-1)).toBe("D");
    });

    test("applies custom config merged with defaults", () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B")];

      const g = graph({
        config: { maxConcurrent: 10 },
        edges,
        entry: "A",
        nodes,
        provider: minimalMockProvider,
      });

      expect(g.config.maxConcurrent).toBe(10);
      expect(g.config.nodeTimeout).toBe(300_000); // default preserved
    });

    test("builds adjacency list correctly", () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C")];
      const edges = [makeEdge("A", "B"), makeEdge("A", "C")];

      const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });

      expect(g.adjacency.get("A")).toHaveLength(2);
      expect(g.adjacency.get("B")).toHaveLength(0);
      expect(g.adjacency.get("C")).toHaveLength(0);
    });

    test("accepts custom executor function", () => {
      const customNode: GraphNode = {
        executor: async (input) => ({ processed: input }),
        id: "custom",
      };
      const nodes = [makeNode("A"), customNode];
      const edges = [makeEdge("A", "custom")];

      const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });

      expect(g.nodes.get("custom")).toBeDefined();
      expect(typeof g.nodes.get("custom")?.executor).toBe("function");
    });
  });

  describe("validation: cycle detection", () => {
    test("rejects A→B→A cycle", () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B"), makeEdge("B", "A")];

      expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
        GraphValidationError
      );
      expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
        /Cycle detected/
      );
    });

    test("rejects A→B→C→A cycle", () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C")];
      const edges = [makeEdge("A", "B"), makeEdge("B", "C"), makeEdge("C", "A")];

      expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
        /Cycle detected/
      );
    });
  });

  describe("validation: self-edges", () => {
    test("rejects A→A self-edge", () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "A"), makeEdge("A", "B")];

      expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
        GraphValidationError
      );
      expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
        /Self-edge.*"A"/
      );
    });
  });

  describe("validation: invalid edge references", () => {
    test("rejects edge to nonexistent target node", () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "Z")];

      expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
        GraphValidationError
      );
      expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
        /nonexistent target.*"Z"/
      );
    });

    test("rejects edge from nonexistent source node", () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("Z", "B")];

      expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
        /nonexistent source.*"Z"/
      );
    });
  });

  describe("validation: orphan nodes", () => {
    test("rejects unreachable orphan node", () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("orphan")];
      const edges = [makeEdge("A", "B")];

      expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
        GraphValidationError
      );
      expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
        /Orphan.*"orphan"/
      );
    });
  });

  describe("validation: entry node", () => {
    test("rejects missing entry node", () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B")];

      expect(() => graph({ edges, entry: "X", nodes, provider: minimalMockProvider })).toThrow(
        /Entry node "X" not found/
      );
    });
  });

  describe("validation: duplicate nodes", () => {
    test("rejects duplicate node ids", () => {
      const nodes = [makeNode("A"), makeNode("A")];
      const edges: Array<GraphEdge> = [];

      expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
        /Duplicate node id.*"A"/
      );
    });
  });

  describe("edge conditions", () => {
    test("preserves condition predicate on edges", () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const conditionFn = (result: unknown) => result === "go";
      const edges: Array<GraphEdge> = [{ condition: conditionFn, from: "A", to: "B" }];

      const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });

      expect(g.edges[0].condition).toBe(conditionFn);
    });
  });
});
