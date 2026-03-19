import { describe, expect, test } from "bun:test";
import { graph } from "../../src/graph/builder";
import { toposort } from "../../src/graph/toposort";
import type { GraphEdge } from "../../src/graph/types";
import { makeEdge, makeNode, minimalMockProvider } from "../utils/helpers";

describe("toposort()", () => {
  test("returns single wave for single node", () => {
    const nodes = [makeNode("A")];
    const edges: Array<GraphEdge> = [];
    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });

    const waves = toposort(g);

    expect(waves).toEqual([["A"]]);
  });

  test("returns linear waves for A→B→C", () => {
    const nodes = [makeNode("A"), makeNode("B"), makeNode("C")];
    const edges = [makeEdge("A", "B"), makeEdge("B", "C")];
    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });

    const waves = toposort(g);

    expect(waves).toEqual([["A"], ["B"], ["C"]]);
  });

  test("returns parallel waves for diamond A→(B,C)→D", () => {
    const nodes = [makeNode("A"), makeNode("B"), makeNode("C"), makeNode("D")];
    const edges = [makeEdge("A", "B"), makeEdge("A", "C"), makeEdge("B", "D"), makeEdge("C", "D")];
    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });

    const waves = toposort(g);

    expect(waves).toHaveLength(3);
    expect(waves[0]).toEqual(["A"]);
    expect(waves[1].sort()).toEqual(["B", "C"]);
    expect(waves[2]).toEqual(["D"]);
  });

  test("returns multiple roots in first wave", () => {
    const nodes = [makeNode("A"), makeNode("B"), makeNode("C")];
    const edges = [makeEdge("A", "C"), makeEdge("B", "C")];
    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });

    const waves = toposort(g);

    expect(waves).toHaveLength(2);
    expect(waves[0].sort()).toEqual(["A", "B"]);
    expect(waves[1]).toEqual(["C"]);
  });

  test("cycles are rejected by graph builder, not toposort", () => {
    const nodes = [makeNode("A"), makeNode("B")];
    const edges = [makeEdge("A", "B"), makeEdge("B", "A")];

    expect(() => graph({ edges, entry: "A", nodes, provider: minimalMockProvider })).toThrow(
      /Cycle detected/
    );
  });

  test("handles complex graph with multiple waves", () => {
    const nodes = [makeNode("A"), makeNode("B"), makeNode("C"), makeNode("D"), makeNode("E")];
    const edges = [
      makeEdge("A", "B"),
      makeEdge("A", "C"),
      makeEdge("B", "D"),
      makeEdge("C", "D"),
      makeEdge("D", "E"),
    ];
    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });

    const waves = toposort(g);

    expect(waves).toHaveLength(4);
    expect(waves[0]).toEqual(["A"]);
    expect(waves[1].sort()).toEqual(["B", "C"]);
    expect(waves[2]).toEqual(["D"]);
    expect(waves[3]).toEqual(["E"]);
  });
});
