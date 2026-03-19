import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { graph } from "../../src/graph/builder";
import { executeGraph } from "../../src/graph/executor";
import type { ExecutionContext } from "../../src/graph/graph-executor-types";
import { buildNodeInput, executeNode } from "../../src/graph/node-executor";
import type { Graph, GraphEdge, GraphNode, NodeResult } from "../../src/graph/types";
import { getGraphFailureError, isGraphFailureEnvelope } from "../../src/graph/types";
import { executeWave } from "../../src/graph/wave-executor";
import type { LLMProvider, LLMResponse, PluginDef } from "../../src/types";
import { agentNode, createEchoMockProvider, delay, edge, fnNode } from "../utils/helpers";

// --- Local Helpers (unique to this file) ---

function trackingProvider(): { calls: Array<string>; provider: LLMProvider } {
  const calls: Array<string> = [];
  const provider: LLMProvider = {
    chat: async (messages) => {
      const userText = messages
        .flatMap((m) => m.content)
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string; type: "text" }).text)
        .join("");
      calls.push(userText);

      return {
        content: [{ text: `result:${userText.slice(0, 20)}`, type: "text" as const }],
        stopReason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    },
    chatStream: async function* () {},
    contextWindowSize: 200_000,
  };
  return { calls, provider };
}

function subgraphNode(id: string, subgraph: Graph): GraphNode {
  return { executor: subgraph, id };
}

// =============================================================================
// Tests
// =============================================================================

describe("executeGraph()", () => {
  test("executes linear A→B→C in correct order", async () => {
    const { calls, provider } = trackingProvider();
    const nodes = [agentNode("A"), agentNode("B"), agentNode("C")];
    const edges = [edge("A", "B"), edge("B", "C")];

    const g = graph({ edges, entry: "A", nodes, provider });
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    expect(Object.keys(result.results)).toEqual(["A", "B", "C"]);

    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain("Execute A");
    expect(calls[1]).toContain("Execute B");
    expect(calls[2]).toContain("Execute C");
  });

  test("passes A's output as B's input", async () => {
    const { calls, provider } = trackingProvider();
    const nodes = [agentNode("A"), agentNode("B")];
    const edges = [edge("A", "B")];

    const g = graph({ edges, entry: "A", nodes, provider });
    await executeGraph(g);

    expect(calls[1]).toContain("result:");
  });

  test("passes run input to entry node", async () => {
    const nodes: Array<GraphNode> = [
      fnNode("A", async (input) => `entry:${String(input)}`),
      fnNode("B", async (input) => `next:${String(input)}`),
    ];
    const edges = [edge("A", "B")];

    const g = graph({ edges, entry: "A", nodes, provider: createEchoMockProvider() });
    const result = await executeGraph(g, undefined, 1, { input: "hello" });

    expect(result.status).toBe("Complete");
    expect(result.results.A.output).toBe("entry:hello");
    expect(result.results.B.output).toBe("next:entry:hello");
  });

  test("B receives A's result as dependency input", async () => {
    const receivedInputs: Array<string> = [];
    const nodes: Array<GraphNode> = [
      fnNode("A", async () => "output-from-A"),
      fnNode("B", async (input) => {
        receivedInputs.push(String(input));
        return "output-from-B";
      }),
      fnNode("C", async (input) => {
        receivedInputs.push(String(input));
        return "output-from-C";
      }),
    ];
    const edges = [edge("A", "B"), edge("B", "C")];

    const g = graph({ edges, entry: "A", nodes, provider: createEchoMockProvider() });
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    expect(receivedInputs[0]).toBe("output-from-A");
    expect(receivedInputs[1]).toBe("output-from-B");
  });

  test("fails fast when a node fails", async () => {
    const nodes: Array<GraphNode> = [
      fnNode("A", async () => "ok"),
      fnNode("B", async () => {
        throw new Error("boom");
      }),
      fnNode("C", async () => "should not run"),
    ];
    const edges = [edge("A", "B"), edge("B", "C")];

    const g = graph({ edges, entry: "A", nodes, provider: createEchoMockProvider() });
    const result = await executeGraph(g);

    if (result.status !== "Failed") {
      throw new Error("Expected failed graph result");
    }
    const failedResult = result;
    expect(failedResult.status).toBe("Failed");
    expect(failedResult.results.B.status).toBe("Failed");
    expect(failedResult.error).toEqual({ error: "boom" });
    expect(failedResult.results.B.output).toEqual({ error: "boom" });
    expect(failedResult.results.C).toBeUndefined();
  });

  test("graph result failed mirrors node failure envelope for node failure path", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [
        fnNode("A", async () => {
          throw new Error("graph-node-fail");
        }),
      ],
      provider: createEchoMockProvider(),
    });

    const result = await executeGraph(g);

    expect(result).toEqual({
      error: { error: "graph-node-fail" },
      results: {
        A: {
          duration: expect.any(Number),
          output: { error: "graph-node-fail" },
          status: "Failed",
        },
      },
      status: "Failed",
    });
  });

  test("graph result failed baseline includes top-level error for invalid resumed node shape", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [fnNode("A", async () => "ok")],
      provider: createEchoMockProvider(),
    });

    const result = await executeGraph(g, undefined, 1, {
      resumeFrom: {
        nodeResults: { A: { bad: true } },
      } as never,
    });

    expect(result).toEqual({
      error: { error: 'Invalid NodeResult from checkpoint: {"bad":true}' },
      results: {},
      status: "Failed",
    });
  });

  test("restores legacy failed checkpoint node result into normalized envelope", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [fnNode("A", async () => "ok")],
      provider: createEchoMockProvider(),
    });

    const result = await executeGraph(g, undefined, 1, {
      resumeFrom: {
        nodeResults: {
          A: {
            completedAt: 25,
            output: "legacy-boom",
            startedAt: 10,
            status: "failed",
          },
        },
      } as never,
    });

    expect(result).toEqual({
      error: { error: "legacy-boom" },
      results: {
        A: {
          duration: 15,
          output: { error: "legacy-boom" },
          status: "Failed",
        },
      },
      status: "Failed",
    });
  });

  test("restores checkpoint-completed nodes and resumes only pending downstream nodes", async () => {
    const seenInputs: Array<string> = [];
    const g = graph({
      edges: [edge("A", "B")],
      entry: "A",
      nodes: [
        fnNode("A", async () => {
          throw new Error("resume should skip restored node");
        }),
        fnNode("B", async (input) => {
          seenInputs.push(String(input));
          return `resumed:${String(input)}`;
        }),
      ],
      provider: createEchoMockProvider(),
    });

    const result = await executeGraph(g, undefined, 1, {
      resumeFrom: {
        nodeResults: {
          A: {
            completedAt: 30,
            output: "restored-A",
            startedAt: 10,
            status: "completed",
          },
        },
      } as never,
    });

    expect(result).toEqual({
      results: {
        A: {
          duration: 20,
          output: "restored-A",
          status: "Complete",
        },
        B: {
          duration: expect.any(Number),
          output: "resumed:restored-A",
          status: "Complete",
        },
      },
      status: "Complete",
    });
    expect(seenInputs).toEqual(["restored-A"]);
  });

  test("restores lowercase failed checkpoint records using explicit error field precedence", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [fnNode("A", async () => "ok")],
      provider: createEchoMockProvider(),
    });

    const result = await executeGraph(g, undefined, 1, {
      resumeFrom: {
        nodeResults: {
          A: {
            completedAt: 40,
            error: "outer-error",
            output: { error: "inner-error", result: { phase: "resume" } },
            startedAt: 10,
            status: "failed",
          },
        },
      } as never,
    });

    expect(result).toEqual({
      error: { error: "outer-error" },
      results: {
        A: {
          duration: 30,
          output: { error: "outer-error" },
          status: "Failed",
        },
      },
      status: "Failed",
    });
  });

  test("invalid resumed checkpoint record returns failed graph with earlier restored results intact", async () => {
    const g = graph({
      edges: [edge("A", "B")],
      entry: "A",
      nodes: [
        fnNode("A", async () => {
          throw new Error("resume should fail before execution");
        }),
        fnNode("B", async () => "ok"),
      ],
      provider: createEchoMockProvider(),
    });

    const result = await executeGraph(g, undefined, 1, {
      resumeFrom: {
        nodeResults: {
          A: {
            completedAt: 20,
            output: "restored-A",
            startedAt: 5,
            status: "completed",
          },
          B: {
            duration: "bad-duration",
            output: { error: "boom" },
            status: "Failed",
          },
        },
      } as never,
    });

    expect(result).toEqual({
      error: {
        error:
          'Invalid NodeResult from checkpoint: {"duration":"bad-duration","output":{"error":"boom"},"status":"Failed"}',
      },
      results: {
        A: {
          duration: 15,
          output: "restored-A",
          status: "Complete",
        },
      },
      status: "Failed",
    });
  });

  test("invalid normalized skipped checkpoint output fails restoration", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [fnNode("A", async () => "ok")],
      provider: createEchoMockProvider(),
    });

    const result = await executeGraph(g, undefined, 1, {
      resumeFrom: {
        nodeResults: {
          A: {
            duration: 0,
            output: "should-be-empty",
            status: "Skipped",
          },
        },
      } as never,
    });

    expect(result).toEqual({
      error: {
        error:
          'Invalid NodeResult from checkpoint: {"duration":0,"output":"should-be-empty","status":"Skipped"}',
      },
      results: {},
      status: "Failed",
    });
  });

  test("invalid legacy checkpoint timestamps fail restoration", async () => {
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [fnNode("A", async () => "ok")],
      provider: createEchoMockProvider(),
    });

    const result = await executeGraph(g, undefined, 1, {
      resumeFrom: {
        nodeResults: {
          A: {
            completedAt: Number.NaN,
            output: "restored-A",
            startedAt: 10,
            status: "completed",
          },
        },
      } as never,
    });

    expect(result).toEqual({
      error: {
        error:
          'Invalid NodeResult from checkpoint: {"completedAt":null,"output":"restored-A","startedAt":10,"status":"completed"}',
      },
      results: {},
      status: "Failed",
    });
  });

  test("respects edge conditions - skips node when condition is false", async () => {
    const executionOrder: Array<string> = [];
    const nodes: Array<GraphNode> = [
      fnNode("A", async () => {
        executionOrder.push("A");
        return "skip-me";
      }),
      fnNode("B", async () => {
        executionOrder.push("B");
        return "done";
      }),
    ];
    const conditionEdge: GraphEdge = {
      condition: (result) => result === "pass",
      from: "A",
      to: "B",
    };

    const g = graph({ edges: [conditionEdge], entry: "A", nodes, provider: createEchoMockProvider() });
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    expect(executionOrder).toEqual(["A"]);
    expect(result.results.B.status).toBe("Skipped");
    expect(result.results.B.output).toBeUndefined();
  });

  test("diamond A→(B,C)→D: B,C execute in parallel (<500ms for 300ms each)", async () => {
    const nodes: Array<GraphNode> = [
      fnNode("A", async () => {
        await delay(50);
        return "A-out";
      }),
      fnNode("B", async () => {
        await delay(300);
        return "B-out";
      }),
      fnNode("C", async () => {
        await delay(300);
        return "C-out";
      }),
      fnNode("D", async (input) => `D-received: ${input}`),
    ];
    const edges = [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D")];

    const g = graph({ edges, entry: "A", nodes, provider: createEchoMockProvider() });

    const start = Date.now();
    const result = await executeGraph(g);
    const duration = Date.now() - start;

    expect(result.status).toBe("Complete");

    // Parallel: ~350ms (B,C run simultaneously), Sequential would be ~650ms (50+300+300)
    expect(duration).toBeLessThan(500);

    // D should receive concatenated input from B and C
    expect(result.results.D.output).toContain("B-out");
    expect(result.results.D.output).toContain("C-out");
  });

  test("executes subgraph node and returns subgraph result", async () => {
    const sub = graph({
      edges: [],
      entry: "S",
      nodes: [fnNode("S", async () => "sub-result")],
      provider: createEchoMockProvider(),
    });
    const nodes: Array<GraphNode> = [fnNode("A", async () => "root"), subgraphNode("B", sub)];
    const edges = [edge("A", "B")];

    const g = graph({ edges, entry: "A", nodes, provider: createEchoMockProvider() });
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    expect(result.results.B.output).toMatchObject({
      results: { S: { output: "sub-result", status: "Complete" } },
      status: "Complete",
    });
  });

  test("subgraph events bubble to parent", async () => {
    const sub = graph({
      edges: [],
      entry: "S",
      nodes: [fnNode("S", async () => "ok")],
      provider: createEchoMockProvider(),
    });
    const nodes: Array<GraphNode> = [subgraphNode("B", sub)];
    const g = graph({ edges: [], entry: "B", nodes, provider: createEchoMockProvider() });

    const events: Array<string> = [];
    await executeGraph(g, (event) => events.push(event.type));

    expect(events).toContain("graph.node.start");
    expect(events).toContain("graph.node.complete");
  });

  test("subgraph inherits parent provider", async () => {
    const { calls, provider } = trackingProvider();
    const sub = graph({
      edges: [],
      entry: "S",
      nodes: [agentNode("S")],
      provider: createEchoMockProvider(),
    });
    const nodes: Array<GraphNode> = [subgraphNode("B", sub)];
    const g = graph({ edges: [], entry: "B", nodes, provider });

    await executeGraph(g);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("Execute S");
  });

  test("fails when nesting depth exceeds max", async () => {
    const leaf = graph({
      edges: [],
      entry: "L",
      nodes: [fnNode("L", async () => "leaf")],
      provider: createEchoMockProvider(),
    });
    const sub2 = graph({
      edges: [],
      entry: "B",
      nodes: [subgraphNode("B", leaf)],
      provider: createEchoMockProvider(),
    });
    const sub1 = graph({
      edges: [],
      entry: "A",
      nodes: [subgraphNode("A", sub2)],
      provider: createEchoMockProvider(),
    });
    const root = graph({
      edges: [],
      entry: "R",
      nodes: [subgraphNode("R", sub1)],
      provider: createEchoMockProvider(),
    });

    expect(executeGraph(root)).rejects.toThrow(/Max graph nesting depth/i);
  });

  test("subgraph failure propagates to parent", async () => {
    const sub = graph({
      edges: [],
      entry: "S",
      nodes: [
        fnNode("S", async () => {
          throw new Error("sub-fail");
        }),
      ],
      provider: createEchoMockProvider(),
    });
    const nodes: Array<GraphNode> = [subgraphNode("B", sub)];
    const g = graph({ edges: [], entry: "B", nodes, provider: createEchoMockProvider() });

    const result = await executeGraph(g);

    expect(result.status).toBe("Failed");
    expect(result.results.B.status).toBe("Failed");
  });
});

describe("buildNodeInput()", () => {
  test("returns empty string for entry node with no deps", () => {
    const nodes = [agentNode("A"), agentNode("B")];
    const edges = [edge("A", "B")];
    const g = graph({ edges, entry: "A", nodes, provider: createEchoMockProvider() });

    const results = new Map<string, NodeResult>();
    const input = buildNodeInput("A", results, g);
    expect(input).toBe("");
  });

  test("concatenates multiple dependency outputs", () => {
    const nodes = [agentNode("A"), agentNode("B"), agentNode("C")];
    const edges = [edge("A", "C"), edge("B", "C")];
    const g = graph({
      edges: [edge("A", "B"), ...edges],
      entry: "A",
      nodes,
      provider: createEchoMockProvider(),
    });

    const results = new Map<string, NodeResult>([
      ["A", { duration: 10, output: "from-A", status: "Complete" }],
      ["B", { duration: 10, output: "from-B", status: "Complete" }],
    ]);

    const input = buildNodeInput("C", results, g);
    expect(input).toContain("from-A");
    expect(input).toContain("from-B");
  });
});

describe("executeNode()", () => {
  test("executes AgentDef via provider.chat()", async () => {
    const provider = createEchoMockProvider();
    const node = agentNode("test");
    const result = await executeNode(node, "hello", provider);

    expect(result.status).toBe("Complete");
    expect(typeof result.output).toBe("string");
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  test("executes custom function directly", async () => {
    const node = fnNode("custom", async (input) => `processed:${input}`);
    const result = await executeNode(node, "data", createEchoMockProvider());

    expect(result.status).toBe("Complete");
    expect(result.output).toBe("processed:data");
  });

  test("catches errors and returns Failed status", async () => {
    const node = fnNode("fail", async () => {
      throw new Error("oops");
    });
    const result = await executeNode(node, "", createEchoMockProvider());

    expect(result.status).toBe("Failed");
    expect(result.output).toEqual({ error: "oops" });
  });

  test("subgraph node failure returns failed NodeResult with normalized nested GraphResult output", async () => {
    const sub = graph({
      edges: [],
      entry: "S",
      nodes: [
        fnNode("S", async () => {
          throw new Error("subgraph-node-boom");
        }),
      ],
      provider: createEchoMockProvider(),
    });

    const result = await executeNode(subgraphNode("B", sub), "", createEchoMockProvider());

    if (result.status !== "Failed") {
      throw new Error("Expected failed node result");
    }
    const failedResult = result;
    expect(failedResult.status).toBe("Failed");
    expect(failedResult.duration).toEqual(expect.any(Number));
    expect(isGraphFailureEnvelope(failedResult.output)).toBe(true);
    expect(failedResult.output.error).toBe("subgraph-node-boom");
    expect(failedResult.output.result).toEqual({
      error: { error: "subgraph-node-boom" },
      results: {
        S: {
          duration: expect.any(Number),
          output: { error: "subgraph-node-boom" },
          status: "Failed",
        },
      },
      status: "Failed",
    });
  });

  test("executes AgentDef with tools using ReAct loop", async () => {
    let toolWasCalled = false;

    const mockTool: PluginDef = {
      description: "Echo the input",
      name: "mock_echo",
      params: z.object({ text: z.string() }),
      run: async (input) => {
        const { text } = input as { text: string };
        toolWasCalled = true;
        return `echo:${text}`;
      },
    };

    const toolAgentNode: GraphNode = {
      executor: {
        name: "tool-agent",
        prompt: "You have a tool available. Use it.",
        tools: [mockTool],
      },
      id: "tool-agent",
    };

    const provider: LLMProvider = {
      chat: async (messages, tools?): Promise<LLMResponse> => {
        const lastMessage = messages.at(-1);
        const hasToolResult = lastMessage?.content.some(
          (c: { type: string }) => c.type === "tool_result"
        );

        if (hasToolResult) {
          return {
            content: [{ text: "Tool execution completed", type: "text" }],
            stopReason: "end_turn",
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }

        if (tools && tools.length > 0) {
          const tool = tools[0];
          return {
            content: [
              {
                input: { text: "hello" },
                name: tool.name,
                toolUseId: "tool_1",
                type: "tool_use",
              },
            ],
            stopReason: "tool_use",
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }

        return {
          content: [{ text: "No tools available", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      chatStream: async function* () {},
      contextWindowSize: 200_000,
    };

    const result = await executeNode(toolAgentNode, "test input", provider);

    expect(result.status).toBe("Complete");
    expect(toolWasCalled).toBe(true);
    expect(result.output).toContain("Tool execution completed");
  });

  test("AgentDef without tools uses single-shot provider.chat()", async () => {
    let chatCallCount = 0;

    const noToolAgentNode: GraphNode = {
      executor: {
        name: "no-tool-agent",
        prompt: "You are a simple agent without tools.",
      },
      id: "no-tool-agent",
    };

    const provider: LLMProvider = {
      chat: async (): Promise<LLMResponse> => {
        chatCallCount++;
        return {
          content: [{ text: "Single response", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      chatStream: async function* () {},
      contextWindowSize: 200_000,
    };

    const result = await executeNode(noToolAgentNode, "test input", provider);

    expect(result.status).toBe("Complete");
    expect(chatCallCount).toBe(1);
    expect(result.output).toBe("Single response");
  });

  test("AgentDef with empty tools array uses single-shot (backward compat)", async () => {
    let chatCallCount = 0;

    const emptyToolsAgentNode: GraphNode = {
      executor: {
        name: "empty-tools-agent",
        prompt: "You are a simple agent.",
        tools: [],
      },
      id: "empty-tools-agent",
    };

    const provider: LLMProvider = {
      chat: async (): Promise<LLMResponse> => {
        chatCallCount++;
        return {
          content: [{ text: "Single response", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      chatStream: async function* () {},
      contextWindowSize: 200_000,
    };

    const result = await executeNode(emptyToolsAgentNode, "test input", provider);

    expect(result.status).toBe("Complete");
    expect(chatCallCount).toBe(1);
    expect(result.output).toBe("Single response");
  });

  test("wave executor returns failed flag and graph.node.failed event uses normalized envelope error", async () => {
    const events: Array<unknown> = [];
    const g = graph({
      edges: [],
      entry: "A",
      nodes: [
        fnNode("A", async () => {
          throw new Error("wave-boom");
        }),
      ],
      provider: createEchoMockProvider(),
    });
    const ctx: ExecutionContext = {
      depth: 1,
      graph: g,
      interruptedNodeId: null,
      onEvent: (event) => {
        events.push(event);
      },
      results: new Map(),
    };

    const waveResult = await executeWave(ctx, ["A"], 0);

    expect(waveResult).toEqual({ status: "Failed" });
    expect(ctx.results.get("A")).toEqual({
      duration: expect.any(Number),
      output: { error: "wave-boom" },
      status: "Failed",
    });
    expect(events).toEqual([
      { nodeId: "A", timestamp: expect.any(Number), type: "graph.node.start" },
      {
        error: "wave-boom",
        nodeId: "A",
        timestamp: expect.any(Number),
        type: "graph.node.failed",
      },
    ]);
  });

  test("failed node envelope helper exposes string error consistently", async () => {
    const result = await executeNode(
      fnNode("fail", async () => {
        throw new Error("helper-boom");
      }),
      "",
      createEchoMockProvider()
    );

    expect(result.status).toBe("Failed");
    expect(getGraphFailureError(result.output)).toBe("helper-boom");
  });
});

describe("conditional edge skipping", () => {
  test("skips node when all incoming conditional edges evaluate to false", async () => {
    const executionOrder: Array<string> = [];
    const nodes: Array<GraphNode> = [
      fnNode("A", async () => {
        executionOrder.push("A");
        return "skip";
      }),
      fnNode("B", async () => {
        executionOrder.push("B");
        return "executed";
      }),
    ];
    const conditionalEdge: GraphEdge = {
      condition: (result) => result === "pass",
      from: "A",
      to: "B",
    };

    const g = graph({ edges: [conditionalEdge], entry: "A", nodes, provider: createEchoMockProvider() });
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    expect(executionOrder).toEqual(["A"]);
    expect(result.results.B.status).toBe("Skipped");
    expect(result.results.B.output).toBeUndefined();
    expect(result.results.B.duration).toBe(0);
  });

  test("executes node when at least one conditional edge evaluates to true", async () => {
    const executionOrder: Array<string> = [];
    const nodes: Array<GraphNode> = [
      fnNode("A", async () => {
        executionOrder.push("A");
        return "pass";
      }),
      fnNode("B", async () => {
        executionOrder.push("B");
        return "executed";
      }),
    ];
    const conditionalEdge: GraphEdge = {
      condition: (result) => result === "pass",
      from: "A",
      to: "B",
    };

    const g = graph({ edges: [conditionalEdge], entry: "A", nodes, provider: createEchoMockProvider() });
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    expect(executionOrder).toEqual(["A", "B"]);
    expect(result.results.B.status).toBe("Complete");
    expect(result.results.B.output).toBe("executed");
  });

  test("executes node with unconditional edge regardless of conditional edges", async () => {
    const executionOrder: Array<string> = [];
    const nodes: Array<GraphNode> = [
      fnNode("A", async () => {
        executionOrder.push("A");
        return "skip-conditions";
      }),
      fnNode("B", async () => {
        executionOrder.push("B");
        return "should-execute";
      }),
      fnNode("C", async () => {
        executionOrder.push("C");
        return "from-C";
      }),
    ];
    const edges: Array<GraphEdge> = [
      { condition: (result) => result === "pass", from: "A", to: "B" },
      { condition: (result) => result === "pass", from: "A", to: "C" },
      edge("C", "B"),
    ];

    const g = graph({ edges, entry: "A", nodes, provider: createEchoMockProvider() });
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    expect(executionOrder).toContain("B");
    expect(result.results.B.status).toBe("Complete");
  });

  test("graph completes successfully when nodes are skipped", async () => {
    const nodes: Array<GraphNode> = [
      fnNode("A", async () => "skip-me"),
      fnNode("B", async () => "should-not-run"),
      fnNode("C", async (input) => `received: ${input}`),
    ];
    const edges: Array<GraphEdge> = [
      { condition: (result) => result === "pass", from: "A", to: "B" },
      edge("A", "C"),
    ];

    const g = graph({ edges, entry: "A", nodes, provider: createEchoMockProvider() });
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    expect(result.results.B.status).toBe("Skipped");
    expect(result.results.C.status).toBe("Complete");
  });

  test("partial skip with multiple conditional edges - executes when any condition is true", async () => {
    const executionOrder: Array<string> = [];
    const nodes: Array<GraphNode> = [
      fnNode("A", async () => {
        executionOrder.push("A");
        return "A-output";
      }),
      fnNode("B", async () => {
        executionOrder.push("B");
        return "B-output";
      }),
      fnNode("C", async () => {
        executionOrder.push("C");
        return "executed";
      }),
    ];
    const edges: Array<GraphEdge> = [
      { condition: (result) => result === "pass-A", from: "A", to: "C" },
      { condition: (result) => result === "B-output", from: "B", to: "C" },
      edge("A", "B"),
    ];

    const g = graph({ edges, entry: "A", nodes, provider: createEchoMockProvider() });
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    expect(executionOrder).toEqual(["A", "B", "C"]);
    expect(result.results.C.status).toBe("Complete");
  });

  test("partial skip with multiple conditional edges - skips when all conditions false", async () => {
    const executionOrder: Array<string> = [];
    const nodes: Array<GraphNode> = [
      fnNode("A", async () => {
        executionOrder.push("A");
        return "A-output";
      }),
      fnNode("B", async () => {
        executionOrder.push("B");
        return "B-output";
      }),
      fnNode("C", async () => {
        executionOrder.push("C");
        return "should-not-execute";
      }),
    ];
    const edges: Array<GraphEdge> = [
      { condition: (result) => result === "pass-A", from: "A", to: "C" },
      { condition: (result) => result === "pass-B", from: "B", to: "C" },
      edge("A", "B"),
    ];

    const g = graph({ edges, entry: "A", nodes, provider: createEchoMockProvider() });
    const result = await executeGraph(g);

    expect(result.status).toBe("Complete");
    expect(executionOrder).toEqual(["A", "B"]);
    expect(result.results.C.status).toBe("Skipped");
  });
});
