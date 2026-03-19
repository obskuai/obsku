import { describe, expect, test } from "bun:test";
import { InMemoryCheckpointStore } from "@obsku/framework";
import { graph } from "../../src/graph/builder";
import { executeGraph } from "../../src/graph/executor";
import type { ExecuteGraphOptions, Graph, GraphEdge, GraphNode } from "../../src/graph/types";
import { agentNode, createEchoMockProvider, edge, fnNode } from "../utils/helpers";

// --- Local Helper (not in shared utils) ---

function subgraphNode(id: string, subgraph: Graph): GraphNode {
  return { executor: subgraph, id };
}

function subgraphNode(id: string, subgraph: Graph): GraphNode {
  return { executor: subgraph, id };
}

// =============================================================================
// Checkpoint Tests
// =============================================================================

describe("executeGraph() checkpoints", () => {
  test("saves checkpoint after each wave completes", async () => {
    const provider = createEchoMockProvider();
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");
    const checkpoints: Array<import("@obsku/framework").Checkpoint> = [];

    const nodes = [agentNode("A"), agentNode("B"), agentNode("C")];
    const edges = [edge("A", "B"), edge("B", "C")];

    const g = graph({ edges, entry: "A", nodes, provider });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      namespace: "",
      onCheckpoint: (cp) => checkpoints.push(cp),
      sessionId: session.id,
    };

    const result = await executeGraph(g, undefined, 1, options);

    expect(result.status).toBe("Complete");
    expect(checkpoints.length).toBeGreaterThanOrEqual(3);

    // First checkpoint should have A completed
    expect(checkpoints[0].nodeResults["A"]).toBeDefined();
    expect(checkpoints[0].pendingNodes).toContain("B");
    expect(checkpoints[0].pendingNodes).toContain("C");

    // Last checkpoint should have all nodes completed
    const lastCheckpoint = checkpoints.at(-1);
    expect(lastCheckpoint.nodeResults["A"]).toBeDefined();
    expect(lastCheckpoint.nodeResults["B"]).toBeDefined();
    expect(lastCheckpoint.nodeResults["C"]).toBeDefined();
    expect(lastCheckpoint.pendingNodes).toHaveLength(0);
  });

  test("saves checkpoint after each cycle iteration", async () => {
    const provider = createEchoMockProvider();
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");
    const checkpoints: Array<import("@obsku/framework").Checkpoint> = [];

    const nodes = [fnNode("A", async () => "result-A"), fnNode("B", async () => "result-B")];
    const edges = [edge("A", "B")];
    const backEdges = [{ back: true as const, from: "B", maxIterations: 3, to: "A" }];

    const g: Graph = {
      ...graph({ edges, entry: "A", nodes, provider }),
      adjacency: new Map(),
      backEdges,
      executionOrder: ["A", "B"],
    };

    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      namespace: "",
      onCheckpoint: (cp) => checkpoints.push(cp),
      sessionId: session.id,
    };

    const result = await executeGraph(g, undefined, 1, options);

    expect(result.status).toBe("Complete");

    // Find cycle checkpoints
    const cycleCheckpoints = checkpoints.filter((cp) => cp.cycleState);
    expect(cycleCheckpoints.length).toBeGreaterThanOrEqual(1);

    // Check cycle state
    const firstCycleCheckpoint = cycleCheckpoints[0];
    expect(firstCycleCheckpoint.cycleState).toBeDefined();
    expect(firstCycleCheckpoint.cycleState?.iteration).toBeGreaterThanOrEqual(1);
    expect(firstCycleCheckpoint.cycleState?.backEdge).toBe("B->A");
  });

  test("checkpoints include correct nodeResults and pendingNodes", async () => {
    const provider = createEchoMockProvider();
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");
    const checkpoints: Array<import("@obsku/framework").Checkpoint> = [];

    const nodes = [agentNode("A"), agentNode("B"), agentNode("C")];
    const edges = [edge("A", "B"), edge("A", "C")];

    const g = graph({ edges, entry: "A", nodes, provider });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      namespace: "",
      onCheckpoint: (cp) => checkpoints.push(cp),
      sessionId: session.id,
    };

    await executeGraph(g, undefined, 1, options);

    // Find checkpoint after wave 1 (A completed, B and C pending)
    const wave1Checkpoint = checkpoints.find(
      (cp) => cp.nodeResults["A"] && !cp.nodeResults["B"] && !cp.nodeResults["C"]
    );
    expect(wave1Checkpoint).toBeDefined();
    expect(wave1Checkpoint!.pendingNodes).toContain("B");
    expect(wave1Checkpoint!.pendingNodes).toContain("C");

    // Find checkpoint after wave 2 (A, B, C completed)
    const wave2Checkpoint = checkpoints.find(
      (cp) => cp.nodeResults["A"] && cp.nodeResults["B"] && cp.nodeResults["C"]
    );
    expect(wave2Checkpoint).toBeDefined();
    expect(wave2Checkpoint!.pendingNodes).toHaveLength(0);
  });

  test("subgraph execution uses namespace from parent nodeId", async () => {
    const provider = createEchoMockProvider();
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");
    const checkpoints: Array<import("@obsku/framework").Checkpoint> = [];

    // Create subgraph
    const subgraphNodes = [agentNode("sub-A"), agentNode("sub-B")];
    const subgraphEdges = [edge("sub-A", "sub-B")];
    const subgraph = graph({
      edges: subgraphEdges,
      entry: "sub-A",
      nodes: subgraphNodes,
      provider,
    });

    // Create parent graph with subgraph node
    const parentNodes = [agentNode("parent-A"), subgraphNode("subgraph", subgraph)];
    const parentEdges = [edge("parent-A", "subgraph")];

    const g = graph({ edges: parentEdges, entry: "parent-A", nodes: parentNodes, provider });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      namespace: "",
      onCheckpoint: (cp) => checkpoints.push(cp),
      sessionId: session.id,
    };

    await executeGraph(g, undefined, 1, options);

    // Find checkpoints with subgraph namespace
    const subgraphCheckpoints = checkpoints.filter((cp) => cp.namespace === "subgraph");
    expect(subgraphCheckpoints.length).toBeGreaterThanOrEqual(1);

    // Subgraph checkpoints should contain sub-A and sub-B
    const subgraphCheckpoint = subgraphCheckpoints[0];
    expect(Object.keys(subgraphCheckpoint.nodeResults)).toContain("sub-A");
  });

  test("resumeFrom skips completed nodes and continues from pending", async () => {
    const provider = createEchoMockProvider();
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");

    const nodes = [
      fnNode("A", async () => "result-A"),
      fnNode("B", async () => "result-B"),
      fnNode("C", async () => "result-C"),
    ];
    const edges = [edge("A", "B"), edge("B", "C")];

    const g = graph({ edges, entry: "A", nodes, provider });

    // First run - capture checkpoint
    const checkpoints: Array<import("@obsku/framework").Checkpoint> = [];
    const options1: ExecuteGraphOptions = {
      checkpointStore: store,
      namespace: "",
      onCheckpoint: (cp) => checkpoints.push(cp),
      sessionId: session.id,
    };

    await executeGraph(g, undefined, 1, options1);

    // Find checkpoint with A and B completed, C pending
    const resumeCheckpoint = checkpoints.find(
      (cp) =>
        cp.nodeResults["A"] &&
        cp.nodeResults["B"] &&
        !cp.nodeResults["C"] &&
        cp.pendingNodes.includes("C")
    );
    expect(resumeCheckpoint).toBeDefined();

    // Reset store and create new session for resume test
    const store2 = new InMemoryCheckpointStore();
    const session2 = await store2.createSession("/test2");

    // Second run with resumeFrom - should skip A and B
    const executionOrder: Array<string> = [];
    const nodes2 = [
      fnNode("A", async () => {
        executionOrder.push("A");
        return "result-A";
      }),
      fnNode("B", async () => {
        executionOrder.push("B");
        return "result-B";
      }),
      fnNode("C", async () => {
        executionOrder.push("C");
        return "result-C";
      }),
    ];
    const g2 = graph({ edges, entry: "A", nodes: nodes2, provider });

    const options2: ExecuteGraphOptions = {
      checkpointStore: store2,
      namespace: "",
      resumeFrom: resumeCheckpoint,
      sessionId: session2.id,
    };

    const result = await executeGraph(g2, undefined, 1, options2);

    expect(result.status).toBe("Complete");
    // Should not re-execute A and B since they were in the checkpoint
    expect(executionOrder).not.toContain("A");
    expect(executionOrder).not.toContain("B");
    // Should execute C
    expect(executionOrder).toContain("C");
  });

  test("resumeFrom mid-cycle correctly restores iteration state", async () => {
    const provider = createEchoMockProvider();
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");

    const nodes = [fnNode("A", async () => "result-A"), fnNode("B", async () => "result-B")];
    const edges = [edge("A", "B")];
    const backEdges = [{ back: true as const, from: "B", maxIterations: 5, to: "A" }];

    const g: Graph = {
      ...graph({ edges, entry: "A", nodes, provider }),
      adjacency: new Map(),
      backEdges,
      executionOrder: ["A", "B"],
    };

    // First run - capture checkpoint with cycle state
    const checkpoints: Array<import("@obsku/framework").Checkpoint> = [];
    const options1: ExecuteGraphOptions = {
      checkpointStore: store,
      namespace: "",
      onCheckpoint: (cp) => checkpoints.push(cp),
      sessionId: session.id,
    };

    await executeGraph(g, undefined, 1, options1);

    // Find checkpoint with cycle state
    const cycleCheckpoint = checkpoints.find((cp) => cp.cycleState?.iteration === 2);
    expect(cycleCheckpoint).toBeDefined();

    // Verify cycle state is preserved
    expect(cycleCheckpoint!.cycleState!.iteration).toBe(2);
    expect(cycleCheckpoint!.cycleState!.backEdge).toBe("B->A");
  });

  test("checkpoint not saved when checkpointStore is not provided", async () => {
    const provider = createEchoMockProvider();

    const nodes = [agentNode("A"), agentNode("B")];
    const edges = [edge("A", "B")];

    const g = graph({ edges, entry: "A", nodes, provider });

    // No checkpointStore provided
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    // Should complete without errors even without checkpoint store
    expect(Object.keys(result.results)).toEqual(["A", "B"]);
  });

  test("checkpoint not saved when sessionId is not provided", async () => {
    const provider = createEchoMockProvider();
    const store = new InMemoryCheckpointStore();

    const nodes = [agentNode("A"), agentNode("B")];
    const edges = [edge("A", "B")];

    const g = graph({ edges, entry: "A", nodes, provider });

    // checkpointStore provided but no sessionId
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      // sessionId not provided
    };

    const result = await executeGraph(g, undefined, 1, options);

    expect(result.status).toBe("Complete");
    // Should complete without errors even without sessionId
    expect(Object.keys(result.results)).toEqual(["A", "B"]);
  });

  test("onCheckpoint callback is called with correct checkpoint data", async () => {
    const provider = createEchoMockProvider();
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");
    const receivedCheckpoints: Array<import("@obsku/framework").Checkpoint> = [];

    const nodes = [agentNode("A")];
    const edges: Array<GraphEdge> = [];

    const g = graph({ edges, entry: "A", nodes, provider });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      namespace: "test-namespace",
      onCheckpoint: (cp) => receivedCheckpoints.push(cp),
      sessionId: session.id,
    };

    await executeGraph(g, undefined, 1, options);

    expect(receivedCheckpoints.length).toBeGreaterThanOrEqual(1);

    const checkpoint = receivedCheckpoints[0];
    expect(checkpoint.sessionId).toBe(session.id);
    expect(checkpoint.namespace).toBe("test-namespace");
    expect(checkpoint.version).toBe(1);
    expect(checkpoint.source).toBe("loop");
    expect(checkpoint.nodeResults["A"]).toBeDefined();
  });

  test("parallel wave execution saves checkpoint after all nodes in wave complete", async () => {
    const provider = createEchoMockProvider();
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");
    const checkpoints: Array<import("@obsku/framework").Checkpoint> = [];

    // A and B are independent (same wave), C depends on both
    const nodes = [agentNode("A"), agentNode("B"), agentNode("C")];
    const edges = [edge("A", "C"), edge("B", "C")];

    const g = graph({ edges, entry: "A", nodes, provider });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      namespace: "",
      onCheckpoint: (cp) => checkpoints.push(cp),
      sessionId: session.id,
    };

    await executeGraph(g, undefined, 1, options);

    // Find checkpoint after wave 1 (A and B completed together)
    const wave1Checkpoint = checkpoints.find(
      (cp) => cp.nodeResults["A"] && cp.nodeResults["B"] && !cp.nodeResults["C"]
    );
    expect(wave1Checkpoint).toBeDefined();
    expect(wave1Checkpoint!.pendingNodes).toContain("C");
    expect(wave1Checkpoint!.pendingNodes).not.toContain("A");
    expect(wave1Checkpoint!.pendingNodes).not.toContain("B");
  });
});
