import { describe, expect, test } from "bun:test";
import { graph } from "../../src/graph/builder";
import { executeGraph } from "../../src/graph/executor";
import type { GraphNode } from "../../src/graph/types";
import type { AgentEvent } from "../../src/types";
import { agentNode, edge, fnNode, minimalMockProvider } from "../utils/helpers";

// =============================================================================
// Event Tests
// =============================================================================

describe("graph.node.* events", () => {
  test("emits graph.node.start before each node execution", async () => {
    const events: Array<AgentEvent> = [];
    const nodes = [agentNode("A"), agentNode("B")];
    const edges = [edge("A", "B")];

    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });
    await executeGraph(g, (event) => events.push(event));

    const startEvents = events.filter((e) => e.type === "graph.node.start");
    expect(startEvents).toHaveLength(2);
    expect(startEvents[0]).toMatchObject({ nodeId: "A", type: "graph.node.start" });
    expect(startEvents[1]).toMatchObject({ nodeId: "B", type: "graph.node.start" });
    expect(startEvents[0].timestamp).toBeGreaterThan(0);
    expect(startEvents[1].timestamp).toBeGreaterThan(0);
  });

  test("emits graph.node.complete with result and duration on success", async () => {
    const events: Array<AgentEvent> = [];
    const nodes = [fnNode("A", async () => "success-output")];

    const g = graph({ edges: [], entry: "A", nodes, provider: minimalMockProvider });
    await executeGraph(g, (event) => events.push(event));

    const completeEvents = events.filter((e) => e.type === "graph.node.complete");
    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0]).toMatchObject({
      nodeId: "A",
      result: "success-output",
      type: "graph.node.complete",
    });
    expect(completeEvents[0].duration).toBeGreaterThanOrEqual(0);
    expect(completeEvents[0].timestamp).toBeGreaterThan(0);
  });

  test("emits graph.node.failed with error message on failure", async () => {
    const events: Array<AgentEvent> = [];
    const nodes = [
      fnNode("A", async () => {
        throw new Error("node-failed-error");
      }),
    ];

    const g = graph({ edges: [], entry: "A", nodes, provider: minimalMockProvider });
    await executeGraph(g, (event) => events.push(event));

    const failedEvents = events.filter((e) => e.type === "graph.node.failed");
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0]).toMatchObject({
      error: "node-failed-error",
      nodeId: "A",
      type: "graph.node.failed",
    });
    expect(failedEvents[0].timestamp).toBeGreaterThan(0);
  });

  test("emits correct event sequence for successful node", async () => {
    const events: Array<AgentEvent> = [];
    const nodes = [fnNode("A", async () => "result")];

    const g = graph({ edges: [], entry: "A", nodes, provider: minimalMockProvider });
    await executeGraph(g, (event) => events.push(event));

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("graph.node.start");
    expect(events[1].type).toBe("graph.node.complete");
    expect(events[0].timestamp).toBeLessThanOrEqual(events[1].timestamp);
  });

  test("emits correct event sequence for failed node", async () => {
    const events: Array<AgentEvent> = [];
    const nodes = [
      fnNode("A", async () => {
        throw new Error("fail");
      }),
    ];

    const g = graph({ edges: [], entry: "A", nodes, provider: minimalMockProvider });
    await executeGraph(g, (event) => events.push(event));

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("graph.node.start");
    expect(events[1].type).toBe("graph.node.failed");
    expect(events[0].timestamp).toBeLessThanOrEqual(events[1].timestamp);
  });

  test("emits events for all nodes in parallel wave", async () => {
    const events: Array<AgentEvent> = [];
    const nodes: Array<GraphNode> = [
      fnNode("A", async () => "A-out"),
      fnNode("B", async () => "B-out"),
      fnNode("C", async () => "C-out"),
    ];
    const edges = [edge("A", "B"), edge("A", "C")];

    const g = graph({ edges, entry: "A", nodes, provider: minimalMockProvider });
    await executeGraph(g, (event) => events.push(event));

    // Should have: A start, A complete, B start, B complete, C start, C complete
    expect(events).toHaveLength(6);

    const startEvents = events.filter((e) => e.type === "graph.node.start");
    const completeEvents = events.filter((e) => e.type === "graph.node.complete");

    expect(startEvents.map((e) => (e as { nodeId: string }).nodeId).sort()).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(completeEvents.map((e) => (e as { nodeId: string }).nodeId).sort()).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
});
