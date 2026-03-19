import { describe, expect, test } from "bun:test";
import { graph } from "../../src/graph/builder";
import { executeGraph } from "../../src/graph/executor";
import type { GraphNode } from "../../src/graph/types";
import { minimalMockProvider } from "../utils/helpers";

function fnNode(id: string): GraphNode {
  return { executor: async () => "ok", id };
}
describe("graph failure characterization", () => {
  test("graph failure envelope characterization preserves resumed failed envelope over sibling error fields", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [fnNode("A")],
      provider: minimalMockProvider,
    });

    const result = await executeGraph(g, undefined, 1, {
      resumeFrom: {
        nodeResults: {
          A: {
            duration: 7,
            error: "outer-error",
            output: { error: "inner-error", result: { phase: "resume" } },
            status: "Failed",
          },
        },
      } as never,
    });

    expect(result).toEqual({
      error: { error: "outer-error" },
      results: {
        A: {
          duration: 7,
          output: { error: "outer-error" },
          status: "Failed",
        },
      },
      status: "Failed",
    });
  });

  test("graph failure envelope characterization uses last normalized failed node as top-level graph error", async () => {
    const g = graph({
      edges: [{ from: "A", to: "B" }],
      entry: "A",
      nodes: [fnNode("A"), fnNode("B")],
      provider: minimalMockProvider,
    });

    const result = await executeGraph(g, undefined, 1, {
      resumeFrom: {
        nodeResults: {
          A: {
            duration: 3,
            output: { error: "first-boom" },
            status: "Failed",
          },
          B: {
            duration: 5,
            output: { error: "second-boom", result: { node: "B" } },
            status: "Failed",
          },
        },
      } as never,
    });

    expect(result).toEqual({
      error: { error: "second-boom", result: { node: "B" } },
      results: {
        A: {
          duration: 3,
          output: { error: "first-boom" },
          status: "Failed",
        },
        B: {
          duration: 5,
          output: { error: "second-boom", result: { node: "B" } },
          status: "Failed",
        },
      },
      status: "Failed",
    });
  });
});
