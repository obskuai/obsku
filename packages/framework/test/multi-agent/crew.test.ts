import { describe, expect, test } from "bun:test";
import { crew } from "../../src/multi-agent/crew";
import type { AgentDef } from "../../src/types";
import { mockLLMProvider } from "../utils/mock-llm-provider";

describe("crew() DSL builder", () => {
  const mockProvider = mockLLMProvider();

  const createAgent = (name: string, prompt: string): AgentDef => ({
    name,
    prompt,
  });

  test("sequential creates linear chain graph", () => {
    const members = [
      { agent: createAgent("a1", "p1"), task: "t1" },
      { agent: createAgent("a2", "p2"), task: "t2" },
      { agent: createAgent("a3", "p3"), task: "t3" },
    ];

    const g = crew({
      members,
      name: "test",
      process: "sequential",
      provider: mockProvider,
    });

    expect(g.entry).toBe("a1");
    expect(g.edges.length).toBe(2);
    expect(g.edges[0]).toMatchObject({ from: "a1", to: "a2" });
    expect(g.edges[1]).toMatchObject({ from: "a2", to: "a3" });
  });

  test("sequential prepends task to agent prompt", () => {
    const members = [{ agent: createAgent("a1", "original prompt"), task: "do something" }];

    const g = crew({
      members,
      name: "test",
      process: "sequential",
      provider: mockProvider,
    });

    const node = g.nodes.get("a1");
    expect(node).toBeDefined();
    expect(typeof node!.executor).toBe("object");
    const executor = node!.executor as AgentDef;
    expect(executor.prompt).toBe("Task: do something\n\noriginal prompt");
  });

  test("empty members throws error", () => {
    expect(() =>
      crew({
        members: [],
        name: "test",
        process: "sequential",
        provider: mockProvider,
      })
    ).toThrow("Empty crew");
  });

  test("sequential graph validation passes", () => {
    const members = [
      { agent: createAgent("a1", "p1"), task: "t1" },
      { agent: createAgent("a2", "p2"), task: "t2" },
    ];

    const g = crew({
      members,
      name: "test",
      process: "sequential",
      provider: mockProvider,
    });

    expect(g.nodes.size).toBe(2);
    expect(g.executionOrder.length).toBe(2);
    expect(g.executionOrder).toEqual(["a1", "a2"]);
  });

  test("sequential with single member has no edges", () => {
    const members = [{ agent: createAgent("solo", "prompt"), task: "task" }];

    const g = crew({
      members,
      name: "test",
      process: "sequential",
      provider: mockProvider,
    });

    expect(g.entry).toBe("solo");
    expect(g.edges.length).toBe(0);
    expect(g.nodes.size).toBe(1);
  });

  test("hierarchical delegates to supervisor", () => {
    const members = [
      { agent: createAgent("w1", "p1"), task: "t1" },
      { agent: createAgent("w2", "p2"), task: "t2" },
    ];

    const g = crew({
      members,
      name: "test",
      process: "hierarchical",
      provider: mockProvider,
    });

    expect(g.entry).toBe("test-manager");
    // Supervisor uses internal routing loop (Task 2 redesign) - only 1 node
    expect(g.nodes.size).toBe(1);
    expect(g.edges.length).toBe(0);
    expect(g.backEdges.length).toBe(0);
  });

  test("sequential entry node is first member", () => {
    const members = [
      { agent: createAgent("first", "p1"), task: "t1" },
      { agent: createAgent("second", "p2"), task: "t2" },
    ];

    const g = crew({
      members,
      name: "test",
      process: "sequential",
      provider: mockProvider,
    });

    expect(g.entry).toBe("first");
    expect(g.nodes.has("first")).toBe(true);
    expect(g.nodes.has("second")).toBe(true);
  });
});
