import { describe, expect, test } from "bun:test";
import { InMemoryCheckpointStore } from "@obsku/framework";
import { graph } from "../../src/graph/builder";
import { executeGraph } from "../../src/graph/executor";
import { resumeGraph } from "../../src/graph/resume";
import type { ExecuteGraphOptions, Graph, GraphEdge, GraphNode } from "../../src/graph/types";
import { interrupt } from "../../src/interrupt/types";
import type { DefaultPublicPayload } from "../../src/output-policy";
import type { AgentEvent, LLMProvider, LLMResponse } from "../../src/types";

function mockProvider(): LLMProvider {
  return {
    chat: async (messages) => {
      const userText = messages
        .filter((m) => m.role === "user")
        .flatMap((m) => m.content)
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string; type: "text" }).text)
        .join("");

      return {
        content: [{ text: userText, type: "text" as const }],
        stopReason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 10 },
      } satisfies LLMResponse;
    },
    chatStream: async function* () {},
    contextWindowSize: 200_000,
  };
}

function fnNode(id: string, fn: (input: unknown) => Promise<unknown>): GraphNode {
  return { executor: fn, id };
}

function edge(from: string, to: string): GraphEdge {
  return { from, to };
}

describe("Graph Interrupt Handling", () => {
  test("interrupt() in node causes Interrupted status", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");

    const nodes = [
      fnNode("A", async () => {
        interrupt({ reason: "need approval" });
      }),
    ];

    const g = graph({ edges: [], entry: "A", nodes, provider: mockProvider() });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      sessionId: session.id,
    };

    const result = await executeGraph(g, undefined, 1, options);
    expect(result.status).toBe("Interrupted");
  });

  test("checkpoint saved with source: 'interrupt'", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");
    const checkpoints: Array<import("@obsku/framework").Checkpoint> = [];

    const nodes = [
      fnNode("A", async () => "ok"),
      fnNode("B", async () => {
        interrupt({ reason: "waiting" });
      }),
    ];

    const g = graph({ edges: [edge("A", "B")], entry: "A", nodes, provider: mockProvider() });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      onCheckpoint: (cp) => checkpoints.push(cp),
      sessionId: session.id,
    };

    await executeGraph(g, undefined, 1, options);

    const interruptCheckpoint = checkpoints.find((cp) => cp.source === "interrupt");
    expect(interruptCheckpoint).toBeDefined();
    expect(interruptCheckpoint!.nodeId).toBe("B");
  });

  test("graph.interrupt event emitted with checkpointId", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");
    const events: Array<DefaultPublicPayload<AgentEvent>> = [];

    const nodes = [
      fnNode("A", async () => {
        interrupt({ reason: "need input", requiresInput: true });
      }),
    ];

    const g = graph({ edges: [], entry: "A", nodes, provider: mockProvider() });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      sessionId: session.id,
    };

    await executeGraph(g, (e) => events.push(e), 1, options);

    const interruptEvent = events.find((e) => e.type === "graph.interrupt") as unknown as {
      data: {
        checkpointId: string;
        nodeId: string;
        reason: string;
        requiresInput: boolean;
      };
      type: "graph.interrupt";
    };
    expect(interruptEvent).toBeDefined();
    expect(interruptEvent.data.nodeId).toBe("A");
    expect(interruptEvent.data.reason).toBe("need input");
    expect(interruptEvent.data.requiresInput).toBe(true);
    expect(interruptEvent.data.checkpointId).toBeDefined();
  });

  test("resumeGraph() loads and continues from checkpoint", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");
    const checkpoints: Array<import("@obsku/framework").Checkpoint> = [];

    let shouldInterrupt = true;
    const executionOrder: Array<string> = [];

    const nodes = [
      fnNode("A", async () => {
        executionOrder.push("A");
        return "a-out";
      }),
      fnNode("B", async () => {
        executionOrder.push("B");
        if (shouldInterrupt) {
          interrupt({ reason: "pause" });
        }
        return "b-out";
      }),
      fnNode("C", async () => {
        executionOrder.push("C");
        return "c-out";
      }),
    ];

    const g = graph({
      edges: [edge("A", "B"), edge("B", "C")],
      entry: "A",
      nodes,
      provider: mockProvider(),
    });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      onCheckpoint: (cp) => checkpoints.push(cp),
      sessionId: session.id,
    };

    const result1 = await executeGraph(g, undefined, 1, options);
    expect(result1.status).toBe("Interrupted");
    expect(executionOrder).toEqual(["A", "B"]);

    const interruptCheckpoint = checkpoints.find((cp) => cp.source === "interrupt");
    expect(interruptCheckpoint).toBeDefined();

    shouldInterrupt = false;
    executionOrder.length = 0;

    const result2 = await resumeGraph(g, interruptCheckpoint!.id, store);
    expect(result2.status).toBe("Complete");
    expect(executionOrder).toEqual(["B", "C"]);
  });

  test("resume passes interruptInput to options", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");

    const _receivedInput: unknown = null;
    let callCount = 0;

    const nodes = [
      fnNode("A", async () => {
        callCount += 1;
        if (callCount === 1) {
          interrupt({ reason: "need data", requiresInput: true });
        }
        return "done";
      }),
    ];

    const g = graph({ edges: [], entry: "A", nodes, provider: mockProvider() });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      sessionId: session.id,
    };

    await executeGraph(g, undefined, 1, options);

    const checkpoint = await store.getLatestCheckpoint(session.id);
    expect(checkpoint).toBeDefined();

    const result = await resumeGraph(g, checkpoint!.id, store, { userApproval: true });
    expect(result.status).toBe("Complete");
  });

  test("resumeGraph throws for non-existent checkpoint", async () => {
    const store = new InMemoryCheckpointStore();
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [fnNode("A", async () => "ok")],
      provider: mockProvider(),
    });

    await expect(resumeGraph(g, "non-existent-id", store)).rejects.toThrow(
      "Checkpoint not found: non-existent-id"
    );
  });

  test("interrupt during parallel wave execution", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");
    const executionOrder: Array<string> = [];

    const nodes = [
      fnNode("A", async () => {
        executionOrder.push("A");
        return "a-out";
      }),
      fnNode("B", async () => {
        executionOrder.push("B");
        interrupt({ reason: "B interrupted" });
      }),
      fnNode("C", async () => {
        executionOrder.push("C");
        return "c-out";
      }),
    ];

    const g = graph({
      edges: [edge("A", "B"), edge("A", "C")],
      entry: "A",
      nodes,
      provider: mockProvider(),
    });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      sessionId: session.id,
    };

    const result = await executeGraph(g, undefined, 1, options);
    expect(result.status).toBe("Interrupted");
    expect(executionOrder).toContain("A");
    expect(result.results.A).toBeDefined();
  });

  test("interrupt during cycle execution", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");
    const checkpoints: Array<import("@obsku/framework").Checkpoint> = [];

    let iterationCount = 0;

    const nodes = [
      fnNode("A", async () => {
        iterationCount += 1;
        if (iterationCount === 2) {
          interrupt({ reason: "cycle pause" });
        }
        return `iteration-${iterationCount}`;
      }),
      fnNode("B", async () => "b-out"),
    ];

    const backEdges = [{ back: true as const, from: "B", maxIterations: 5, to: "A" }];

    const g: Graph = {
      ...graph({ edges: [edge("A", "B")], entry: "A", nodes, provider: mockProvider() }),
      adjacency: new Map(),
      backEdges,
      executionOrder: ["A", "B"],
    };

    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      onCheckpoint: (cp) => checkpoints.push(cp),
      sessionId: session.id,
    };

    const result = await executeGraph(g, undefined, 1, options);
    expect(result.status).toBe("Interrupted");

    const interruptCheckpoint = checkpoints.find((cp) => cp.source === "interrupt");
    expect(interruptCheckpoint).toBeDefined();
    expect(interruptCheckpoint!.cycleState).toBeDefined();
    expect(interruptCheckpoint!.cycleState!.iteration).toBeGreaterThanOrEqual(1);
  });

  test("resume from cycle checkpoint continues execution", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");
    const checkpoints: Array<import("@obsku/framework").Checkpoint> = [];

    let shouldInterrupt = true;
    let iterationCount = 0;

    const nodes = [
      fnNode("A", async () => {
        iterationCount += 1;
        if (shouldInterrupt && iterationCount === 2) {
          interrupt({ reason: "cycle pause" });
        }
        return `iteration-${iterationCount}`;
      }),
      fnNode("B", async () => "b-out"),
    ];

    const backEdges = [{ back: true as const, from: "B", maxIterations: 3, to: "A" }];

    const g: Graph = {
      ...graph({ edges: [edge("A", "B")], entry: "A", nodes, provider: mockProvider() }),
      adjacency: new Map(),
      backEdges,
      executionOrder: ["A", "B"],
    };

    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      onCheckpoint: (cp) => checkpoints.push(cp),
      sessionId: session.id,
    };

    const result1 = await executeGraph(g, undefined, 1, options);
    expect(result1.status).toBe("Interrupted");

    const interruptCheckpoint = checkpoints.find((cp) => cp.source === "interrupt");
    expect(interruptCheckpoint).toBeDefined();
    expect(interruptCheckpoint!.cycleState).toBeDefined();

    shouldInterrupt = false;

    const result2 = await resumeGraph(g, interruptCheckpoint!.id, store);
    expect(result2.status).toBe("Complete");
  });

  test("interrupt preserves completed node results", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");

    const nodes = [
      fnNode("A", async () => "result-A"),
      fnNode("B", async () => "result-B"),
      fnNode("C", async () => {
        interrupt({ reason: "stop" });
      }),
    ];

    const g = graph({
      edges: [edge("A", "B"), edge("B", "C")],
      entry: "A",
      nodes,
      provider: mockProvider(),
    });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      sessionId: session.id,
    };

    const result = await executeGraph(g, undefined, 1, options);
    expect(result.status).toBe("Interrupted");
    expect(result.results.A).toBeDefined();
    expect(result.results.A.output).toBe("result-A");
    expect(result.results.B).toBeDefined();
    expect(result.results.B.output).toBe("result-B");
    expect(result.results.C).toBeUndefined();
  });

  test("interrupt without checkpoint store still returns Interrupted", async () => {
    const nodes = [
      fnNode("A", async () => {
        interrupt({ reason: "no store" });
      }),
    ];

    const g = graph({ edges: [], entry: "A", nodes, provider: mockProvider() });

    const result = await executeGraph(g);
    expect(result.status).toBe("Interrupted");
  });

  test("multiple nodes can complete before interrupt in parallel wave", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");

    const nodes = [
      fnNode("A", async () => "a-out"),
      fnNode("B", async () => "b-out"),
      fnNode("C", async () => {
        interrupt({ reason: "pause" });
      }),
      fnNode("D", async () => "d-out"),
    ];

    const g = graph({
      edges: [edge("A", "B"), edge("A", "C"), edge("A", "D")],
      entry: "A",
      nodes,
      provider: mockProvider(),
    });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      sessionId: session.id,
    };

    const result = await executeGraph(g, undefined, 1, options);
    expect(result.status).toBe("Interrupted");
    expect(result.results.A).toBeDefined();
  });

  test("checkpoint nodeId set to interrupted node", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");
    const checkpoints: Array<import("@obsku/framework").Checkpoint> = [];

    const nodes = [
      fnNode("A", async () => "ok"),
      fnNode("target-node", async () => {
        interrupt({ reason: "target interrupted" });
      }),
    ];

    const g = graph({
      edges: [edge("A", "target-node")],
      entry: "A",
      nodes,
      provider: mockProvider(),
    });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      onCheckpoint: (cp) => checkpoints.push(cp),
      sessionId: session.id,
    };

    await executeGraph(g, undefined, 1, options);

    const interruptCheckpoint = checkpoints.find((cp) => cp.source === "interrupt");
    expect(interruptCheckpoint).toBeDefined();
    expect(interruptCheckpoint!.nodeId).toBe("target-node");
  });

  test("double resume on same checkpoint is idempotent", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");

    let callCount = 0;
    const nodes = [
      fnNode("A", async () => {
        callCount += 1;
        if (callCount === 1) {
          interrupt({ reason: "first run" });
        }
        return `call-${callCount}`;
      }),
    ];

    const g = graph({ edges: [], entry: "A", nodes, provider: mockProvider() });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      sessionId: session.id,
    };

    await executeGraph(g, undefined, 1, options);

    const checkpoint = await store.getLatestCheckpoint(session.id);
    expect(checkpoint).toBeDefined();

    const result1 = await resumeGraph(g, checkpoint!.id, store);
    expect(result1.status).toBe("Complete");

    callCount = 1;
    const result2 = await resumeGraph(g, checkpoint!.id, store);
    expect(result2.status).toBe("Complete");
  });

  test("resume after parallel-wave interrupt reruns unresolved peers", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/test");

    let shouldInterrupt = true;
    const executionOrder: Array<string> = [];
    const nodes = [
      fnNode("A", async () => {
        executionOrder.push("A");
        return "a-out";
      }),
      fnNode("B", async () => {
        executionOrder.push(shouldInterrupt ? "B:interrupt" : "B:resume");
        if (shouldInterrupt) {
          interrupt({ reason: "pause" });
        }
        return "b-out";
      }),
      fnNode("C", async () => {
        executionOrder.push(shouldInterrupt ? "C:first-wave" : "C:resume-wave");
        return "c-out";
      }),
      fnNode("D", async () => {
        executionOrder.push("D");
        return "d-out";
      }),
    ];

    const g = graph({
      edges: [edge("A", "B"), edge("A", "C"), edge("B", "D")],
      entry: "A",
      nodes,
      provider: mockProvider(),
    });
    const options: ExecuteGraphOptions = {
      checkpointStore: store,
      sessionId: session.id,
    };

    const interrupted = await executeGraph(g, undefined, 1, options);
    expect(interrupted.status).toBe("Interrupted");
    expect(interrupted.results.A.output).toBe("a-out");
    expect(interrupted.results.B).toBeUndefined();
    expect(interrupted.results.C).toBeUndefined();
    expect(interrupted.results.D).toBeUndefined();
    expect(executionOrder).toEqual(["A", "B:interrupt", "C:first-wave"]);

    shouldInterrupt = false;
    executionOrder.length = 0;

    const checkpoint = await store.getLatestCheckpoint(session.id);
    expect(checkpoint).toBeDefined();

    const resumed = await resumeGraph(g, checkpoint!.id, store);
    expect(resumed.status).toBe("Complete");
    expect(executionOrder).toEqual(["B:resume", "C:resume-wave", "D"]);
    expect(resumed.results.A.output).toBe("a-out");
    expect(resumed.results.B.output).toBe("b-out");
    expect(resumed.results.C.output).toBe("c-out");
    expect(resumed.results.D.output).toBe("d-out");
  });

  test("conditional-only branches mark skipped nodes across dependent waves", async () => {
    const executionOrder: Array<string> = [];
    const nodes = [
      fnNode("A", async () => {
        executionOrder.push("A");
        return { route: "left" };
      }),
      fnNode("B", async () => {
        executionOrder.push("B");
        return "b-out";
      }),
      fnNode("C", async () => {
        executionOrder.push("C");
        return "c-out";
      }),
      fnNode("D", async () => {
        executionOrder.push("D");
        return "d-out";
      }),
    ];

    const g = graph({
      edges: [
        {
          condition: (result) => (result as { route: string }).route === "right",
          from: "A",
          to: "B",
        },
        { condition: (result) => result === "b-out", from: "B", to: "C" },
        {
          condition: (result) => (result as { route: string }).route === "left",
          from: "A",
          to: "D",
        },
      ],
      entry: "A",
      nodes,
      provider: mockProvider(),
    });

    const result = await executeGraph(g);
    expect(result.status).toBe("Complete");
    expect(executionOrder).toEqual(["A", "D"]);
    expect(result.results.B).toEqual({ duration: 0, output: undefined, status: "Skipped" });
    expect(result.results.C).toEqual({ duration: 0, output: undefined, status: "Skipped" });
    expect(result.results.D.output).toBe("d-out");
  });

  test("failed node stops later waves and drops later same-wave results", async () => {
    const executionOrder: Array<string> = [];
    const nodes = [
      fnNode("A", async () => {
        executionOrder.push("A");
        return "a-out";
      }),
      fnNode("B", async () => {
        executionOrder.push("B");
        throw new Error("boom");
      }),
      fnNode("C", async () => {
        executionOrder.push("C");
        return "c-out";
      }),
      fnNode("D", async () => {
        executionOrder.push("D");
        return "d-out";
      }),
    ];

    const g = graph({
      edges: [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D")],
      entry: "A",
      nodes,
      provider: mockProvider(),
    });

    const result = await executeGraph(g);
    expect(result.status).toBe("Failed");
    expect(executionOrder).toEqual(["A", "B", "C"]);
    if ("error" in result) {
      expect(result.error.error).toBe("boom");
      expect(result.results.A.output).toBe("a-out");
      expect(result.results.B.status).toBe("Failed");
      expect(result.results.B.duration).toBeGreaterThanOrEqual(0);
      expect(result.results.B.output).toEqual({ error: "boom" });
    }
    expect(result.results.C).toBeUndefined();
    expect(result.results.D).toBeUndefined();
  });

  test("cycle execution honors maxIterations and emits paired events", async () => {
    const events: Array<DefaultPublicPayload<AgentEvent>> = [];
    let aCalls = 0;
    let bCalls = 0;

    const nodes = [
      fnNode("A", async () => {
        aCalls += 1;
        return `a-${aCalls}`;
      }),
      fnNode("B", async () => {
        bCalls += 1;
        return `b-${bCalls}`;
      }),
    ];

    const baseGraph = graph({
      edges: [edge("A", "B")],
      entry: "A",
      nodes,
      provider: mockProvider(),
    });
    const g: Graph = {
      ...baseGraph,
      backEdges: [{ back: true as const, from: "B", maxIterations: 3, to: "A" }],
    };

    const result = await executeGraph(g, (event) => events.push(event));
    expect(result.status).toBe("Complete");
    expect(aCalls).toBe(4);
    expect(bCalls).toBe(4);
    expect(result.results.A.output).toBe("a-4");
    expect(result.results.B.output).toBe("b-4");

    const cycleStarts = events.filter(
      (event): event is DefaultPublicPayload<Extract<AgentEvent, { type: "graph.cycle.start" }>> =>
        event.type === "graph.cycle.start"
    );
    const cycleCompletes = events.filter(
      (
        event
      ): event is DefaultPublicPayload<Extract<AgentEvent, { type: "graph.cycle.complete" }>> =>
        event.type === "graph.cycle.complete"
    );

    expect(cycleStarts.map((event) => event.data.iteration)).toEqual([1, 2, 3]);
    expect(cycleCompletes.map((event) => event.data.iteration)).toEqual([1, 2, 3]);
    expect(
      cycleStarts.every(
        (event) =>
          event.data.from === "B" && event.data.maxIterations === 3 && event.data.to === "A"
      )
    ).toBe(true);
    expect(
      cycleCompletes.every(
        (event) =>
          event.data.from === "B" && event.data.maxIterations === 3 && event.data.to === "A"
      )
    ).toBe(true);
  });

  test("restored failed checkpoints keep failure envelope parity and skip rerun", async () => {
    let callCount = 0;
    const nodes = [
      fnNode("A", async () => {
        callCount += 1;
        return "a-out";
      }),
      fnNode("B", async () => {
        callCount += 1;
        throw new Error("restored boom");
      }),
      fnNode("C", async () => {
        callCount += 1;
        return "c-out";
      }),
    ];

    const g = graph({
      edges: [edge("A", "B"), edge("B", "C")],
      entry: "A",
      nodes,
      provider: mockProvider(),
    });

    const liveResult = await executeGraph(g);
    expect(liveResult.status).toBe("Failed");
    if (liveResult.status !== "Failed") {
      throw new Error(`Expected Failed result, got ${liveResult.status}`);
    }
    expect(liveResult.results.B.status).toBe("Failed");

    const resumeFrom: NonNullable<ExecuteGraphOptions["resumeFrom"]> = {
      createdAt: Date.now(),
      id: "restored-failure",
      namespace: "",
      nodeId: "B",
      nodeResults: {
        A: { completedAt: 4, output: "a-out", startedAt: 1, status: "completed" },
        B: {
          completedAt: 9,
          output: liveResult.results.B.output,
          startedAt: 5,
          status: "failed",
        },
        C: { completedAt: 9, startedAt: 9, status: "skipped" },
      },
      pendingNodes: [],
      sessionId: "restored-session",
      source: "interrupt",
      step: 2,
      version: 1,
    };

    const restoredResult = await executeGraph(g, undefined, 1, { resumeFrom });
    expect(restoredResult.status).toBe("Failed");
    expect(callCount).toBe(2);
    if ("error" in restoredResult) {
      expect(restoredResult.error).toEqual(liveResult.error);
      expect(restoredResult.results.A.status).toBe("Complete");
      expect(restoredResult.results.A.duration).toBe(3);
      expect(restoredResult.results.A.output).toBe("a-out");
      expect(restoredResult.results.B.status).toBe("Failed");
      expect(restoredResult.results.B.duration).toBe(4);
      expect(restoredResult.results.B.output).toEqual(liveResult.results.B.output);
      expect(restoredResult.results.C.status).toBe("Skipped");
      expect(restoredResult.results.C.duration).toBe(0);
      expect(restoredResult.results.C.output).toBeUndefined();
    }
  });
});
