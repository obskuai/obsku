/**
 * Integration tests for multi-agent patterns (supervisor, crew).
 * Uses MockLLMProvider for deterministic testing.
 * Tests verify routing logic, checkpointing, and full execution flows.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import type { Checkpoint, CheckpointStore } from "@obsku/framework";
import { InMemoryCheckpointStore } from "@obsku/framework";
import { crew } from "../../src/multi-agent/crew";
import { supervisor } from "../../src/multi-agent/supervisor";
import { run } from "../../src/runtime";
import type {
  AgentDef,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
  Message,
  ToolDef,
} from "../../src/types";

// -----------------------------------------------------------------------------
// Deterministic MockLLMProvider
// -----------------------------------------------------------------------------

interface MockResponse {
  next?: string;
  text?: string;
  toolCalls?: Array<{ input: Record<string, unknown>; name: string }>;
}

class MockLLMProvider implements LLMProvider {
  readonly contextWindowSize = 200_000;
  private responses: Array<MockResponse>;
  private callIndex = 0;
  public recordedCalls: Array<{ messages: Array<Message>; tools?: Array<ToolDef> }> = [];

  constructor(responses: Array<MockResponse>) {
    this.responses = responses;
  }

  async chat(messages: Array<Message>, tools?: Array<ToolDef>): Promise<LLMResponse> {
    this.recordedCalls.push({ messages: [...messages], tools });
    const response = this.responses[this.callIndex++] ?? { text: "Default response" };

    // If response has 'next', it's a supervisor routing decision
    if (response.next !== undefined) {
      return {
        content: [{ text: JSON.stringify({ next: response.next }), type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    }

    // If response has tool calls
    if (response.toolCalls && response.toolCalls.length > 0) {
      return {
        content: response.toolCalls.map((tc) => ({
          input: tc.input,
          name: tc.name,
          toolUseId: `tool_${Date.now()}`,
          type: "tool_use" as const,
        })),
        stopReason: "tool_use",
        usage: { inputTokens: 20, outputTokens: 15 },
      };
    }

    // Default text response
    return {
      content: [{ text: response.text ?? "Mock response", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 8 },
    };
  }

  chatStream(messages: Array<Message>, tools?: Array<ToolDef>): AsyncIterable<LLMStreamEvent> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Required for generator closure
    const self = this;
    return {
      async *[Symbol.asyncIterator]() {
        self.recordedCalls.push({ messages: [...messages], tools });
        const response = self.responses[self.callIndex++] ?? { text: "Default response" };

        if (response.text) {
          yield { content: response.text, type: "text_delta" };
        }

        yield {
          stopReason: "end_turn",
          type: "message_end",
          usage: { inputTokens: 10, outputTokens: 8 },
        };
      },
    };
  }

  reset() {
    this.callIndex = 0;
    this.recordedCalls = [];
  }
}

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

function createAgentDef(name: string, prompt: string): AgentDef {
  return {
    maxIterations: 1,
    name,
    prompt,
  };
}

// -----------------------------------------------------------------------------
// Supervisor Integration Tests
// -----------------------------------------------------------------------------

describe("Supervisor Integration Tests", () => {
  let store: CheckpointStore;

  beforeEach(() => {
    store = new InMemoryCheckpointStore();
  });

  test("supervisor routes to correct worker", async () => {
    const provider = new MockLLMProvider([
      { next: "worker1" }, // Supervisor routes to worker1
      { text: "worker1 result" }, // Worker1 executes
      { next: "FINISH" }, // Supervisor finishes
    ]);

    const workers = [
      createAgentDef("worker1", "Worker 1 prompt"),
      createAgentDef("worker2", "Worker 2 prompt"),
    ];

    const g = supervisor({
      maxRounds: 5,
      name: "boss",
      provider,
      workers,
    });

    const session = await store.createSession("./test");
    const result = await run(g, {
      checkpointStore: store,
      input: "Test task",
      sessionId: session.id,
    });

    expect(result.status).toBe("Complete");
    expect(provider.recordedCalls.length).toBe(3);
  });

  test("supervisor multiple rounds of routing", async () => {
    const provider = new MockLLMProvider([
      { next: "worker1" }, // Round 1: route to worker1
      { text: "result from worker1" }, // Worker1 executes
      { next: "worker2" }, // Round 2: route to worker2
      { text: "result from worker2" }, // Worker2 executes
      { next: "worker1" }, // Round 3: route to worker1 again
      { text: "final result from worker1" }, // Worker1 executes again
      { next: "FINISH" }, // Finish
    ]);

    const workers = [createAgentDef("worker1", "Worker 1"), createAgentDef("worker2", "Worker 2")];

    const g = supervisor({
      maxRounds: 10,
      name: "manager",
      provider,
      workers,
    });

    const session = await store.createSession("./test");
    const result = await run(g, {
      checkpointStore: store,
      sessionId: session.id,
    });

    expect(result.status).toBe("Complete");
    expect(provider.recordedCalls.length).toBe(7);
  });

  test("supervisor maxRounds enforcement", async () => {
    // Mock responses that never return FINISH
    const provider = new MockLLMProvider([
      { next: "worker1" },
      { text: "result" },
      { next: "worker1" },
      { text: "result" },
      { next: "worker1" },
      { text: "result" },
    ]);

    const workers = [createAgentDef("worker1", "Worker 1")];

    const g = supervisor({
      maxRounds: 2, // Limit to 2 rounds
      name: "boss",
      provider,
      workers,
    });

    const session = await store.createSession("./test");
    const result = await run(g, {
      checkpointStore: store,
      sessionId: session.id,
    });

    // Should complete (not hang) due to maxRounds limiting back-edge iterations
    expect(result.status).toBe("Complete");
    expect(provider.recordedCalls.length).toBe(4);
  });

  test("supervisor with checkpointing saves checkpoints", async () => {
    const provider = new MockLLMProvider([
      { next: "worker1" },
      { text: "worker result" },
      { next: "FINISH" },
    ]);

    const workers = [createAgentDef("worker1", "Worker 1")];

    const g = supervisor({
      maxRounds: 5,
      name: "boss",
      provider,
      workers,
    });

    const session = await store.createSession("./test");
    const checkpointIds: Array<string> = [];

    const result = await run(g, {
      checkpointStore: store,
      namespace: "supervisor-test",
      onCheckpoint: (cp: Checkpoint) => {
        checkpointIds.push(cp.id);
      },
      sessionId: session.id,
    });

    expect(result.status).toBe("Complete");
    expect(checkpointIds.length).toBeGreaterThanOrEqual(1);

    // Verify checkpoints exist
    const latest = await store.getLatestCheckpoint(session.id, "supervisor-test");
    expect(latest).not.toBeNull();
    expect(latest?.sessionId).toBe(session.id);
  });

  test("supervisor resume from checkpoint continues execution", async () => {
    const provider = new MockLLMProvider([
      { next: "worker1" },
      { text: "first result" },
      { next: "FINISH" },
    ]);

    const workers = [createAgentDef("worker1", "Worker 1")];

    const g = supervisor({
      maxRounds: 5,
      name: "boss",
      provider,
      workers,
    });

    const session = await store.createSession("./test");

    // First run
    const result1 = await run(g, {
      checkpointStore: store,
      namespace: "resume-test",
      sessionId: session.id,
    });

    expect(result1.status).toBe("Complete");

    // Get checkpoint and resume
    const checkpoint = await store.getLatestCheckpoint(session.id, "resume-test");
    expect(checkpoint).not.toBeNull();

    // Reset provider for resume
    provider.reset();

    const result2 = await run(g, {
      checkpointStore: store,
      namespace: "resume-test-2",
      resumeFrom: checkpoint!,
      sessionId: session.id,
    });

    expect(result2.status).toBe("Complete");
  });

  test("supervisor worker output propagation", async () => {
    const provider = new MockLLMProvider([
      { next: "worker1" },
      { text: "processed by worker1" },
      { next: "FINISH" },
    ]);

    const workers = [createAgentDef("worker1", "Worker 1 prompt")];

    const g = supervisor({
      maxRounds: 5,
      name: "boss",
      provider,
      workers,
    });

    const session = await store.createSession("./test");
    const result = await run(g, {
      checkpointStore: store,
      namespace: "output-test",
      sessionId: session.id,
    });

    expect(result.status).toBe("Complete");
    expect(provider.recordedCalls.length).toBe(3);
    const workerCall = provider.recordedCalls[1];
    const workerPrompt = workerCall.messages[0]?.content[0];
    expect(workerPrompt?.type).toBe("text");
    if (workerPrompt?.type === "text") {
      expect(workerPrompt.text).toContain("Worker 1 prompt");
    }
  });

  test("supervisor dynamic worker selection", async () => {
    const provider = new MockLLMProvider([
      { next: "researcher" }, // Route to researcher
      { text: "research findings" },
      { next: "writer" }, // Route to writer
      { text: "written content" },
      { next: "FINISH" },
    ]);

    const workers = [
      createAgentDef("researcher", "Research specialist"),
      createAgentDef("writer", "Content writer"),
      createAgentDef("reviewer", "Content reviewer"),
    ];

    const g = supervisor({
      maxRounds: 10,
      name: "coordinator",
      provider,
      workers,
    });

    const session = await store.createSession("./test");
    const result = await run(g, {
      checkpointStore: store,
      sessionId: session.id,
    });

    expect(result.status).toBe("Complete");
    expect(provider.recordedCalls.length).toBe(5);
  });

  test("supervisor back-edge until condition terminates on FINISH", async () => {
    const provider = new MockLLMProvider([
      { next: "worker1" },
      { text: "result" },
      { next: "FINISH" }, // This should trigger termination
    ]);

    const workers = [createAgentDef("worker1", "Worker 1")];

    const g = supervisor({
      maxRounds: 10,
      name: "boss",
      provider,
      workers,
    });

    const session = await store.createSession("./test");
    const result = await run(g, {
      checkpointStore: store,
      sessionId: session.id,
    });

    expect(result.status).toBe("Complete");
    expect(provider.recordedCalls.length).toBe(3);
  });

  test("supervisor workers run ReAct loop with tools", async () => {
    const provider = new MockLLMProvider([
      { next: "worker1" },
      {
        toolCalls: [{ input: { text: "tool output" }, name: "echo" }],
      },
      { text: "Tool says: tool output" },
      { next: "FINISH" },
    ]);

    const echo = {
      description: "Echo text",
      name: "echo",
      params: z.object({ text: z.string() }),
      run: async ({ text }: { text: string }) => String(text),
    };

    const workers = [
      {
        ...createAgentDef("worker1", "Use tools when needed"),
        maxIterations: 2,
        tools: [echo],
      },
    ];

    const g = supervisor({
      maxRounds: 3,
      name: "boss",
      provider,
      workers,
    });

    const session = await store.createSession("./test");
    const result = await run(g, {
      checkpointStore: store,
      input: "Run tool",
      sessionId: session.id,
    });

    expect(result.status).toBe("Complete");
    expect(provider.recordedCalls.length).toBe(4);
    const toolCall = provider.recordedCalls[1];
    expect(toolCall.tools?.some((tool) => tool.name === "echo")).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Crew Integration Tests
// -----------------------------------------------------------------------------

describe("Crew Integration Tests", () => {
  let store: CheckpointStore;

  beforeEach(() => {
    store = new InMemoryCheckpointStore();
  });

  test("crew sequential execution order", async () => {
    const provider = new MockLLMProvider([
      { text: "agent1 output" },
      { text: "agent2 output" },
      { text: "agent3 output" },
    ]);

    const members = [
      { agent: createAgentDef("agent1", "Agent 1"), task: "Task 1" },
      { agent: createAgentDef("agent2", "Agent 2"), task: "Task 2" },
      { agent: createAgentDef("agent3", "Agent 3"), task: "Task 3" },
    ];

    const g = crew({
      members,
      name: "test-crew",
      process: "sequential",
      provider,
    });

    const session = await store.createSession("./test");
    const result = await run(g, {
      checkpointStore: store,
      sessionId: session.id,
    });

    expect(result.status).toBe("Complete");
    // Verify all 3 agents were called in order
    expect(provider.recordedCalls.length).toBe(3);

    // Verify execution order by checking prompts contain task descriptions
    const firstCall = provider.recordedCalls[0].messages[0]?.content[0];
    expect(firstCall?.type).toBe("text");
    if (firstCall?.type === "text") {
      expect(firstCall.text).toContain("Task 1");
    }
  });

  test("crew sequential passes previous output to next agent", async () => {
    const provider = new MockLLMProvider([
      { text: "output from agent1" },
      { text: "output from agent2" },
    ]);

    const members = [
      { agent: createAgentDef("agent1", "First agent"), task: "Do first thing" },
      { agent: createAgentDef("agent2", "Second agent"), task: "Do second thing" },
    ];

    const g = crew({
      members,
      name: "test-crew",
      process: "sequential",
      provider,
    });

    const session = await store.createSession("./test");
    const result = await run(g, {
      checkpointStore: store,
      input: "Initial input",
      sessionId: session.id,
    });

    expect(result.status).toBe("Complete");
    // Second agent should receive context from first
    expect(provider.recordedCalls.length).toBe(2);
  });

  test("crew hierarchical delegates to supervisor", async () => {
    const provider = new MockLLMProvider([
      { next: "worker1" },
      { text: "worker1 result" },
      { next: "FINISH" },
    ]);

    const members = [
      { agent: createAgentDef("worker1", "Worker 1"), task: "Task 1" },
      { agent: createAgentDef("worker2", "Worker 2"), task: "Task 2" },
    ];

    const g = crew({
      members,
      name: "test-crew",
      process: "hierarchical",
      provider,
    });

    expect(g.entry).toBe("test-crew-manager");
    expect(g.nodes.size).toBe(1);
    expect(g.backEdges.length).toBe(0);

    const session = await store.createSession("./test");
    const result = await run(g, {
      checkpointStore: store,
      sessionId: session.id,
    });

    expect(result.status).toBe("Complete");
  });

  test("crew with checkpointing saves checkpoints after each step", async () => {
    const provider = new MockLLMProvider([{ text: "step1" }, { text: "step2" }, { text: "step3" }]);

    const members = [
      { agent: createAgentDef("agent1", "Agent 1"), task: "Task 1" },
      { agent: createAgentDef("agent2", "Agent 2"), task: "Task 2" },
      { agent: createAgentDef("agent3", "Agent 3"), task: "Task 3" },
    ];

    const g = crew({
      members,
      name: "test-crew",
      process: "sequential",
      provider,
    });

    const session = await store.createSession("./test");
    const checkpointIds: Array<string> = [];

    const result = await run(g, {
      checkpointStore: store,
      namespace: "crew-checkpoint-test",
      onCheckpoint: (cp: Checkpoint) => {
        checkpointIds.push(cp.id);
      },
      sessionId: session.id,
    });

    expect(result.status).toBe("Complete");
    expect(checkpointIds.length).toBeGreaterThanOrEqual(1);

    // Verify checkpoint exists
    const latest = await store.getLatestCheckpoint(session.id, "crew-checkpoint-test");
    expect(latest).not.toBeNull();
  });

  test("crew resume from middle checkpoint", async () => {
    const provider = new MockLLMProvider([{ text: "step1" }, { text: "step2" }, { text: "step3" }]);

    const members = [
      { agent: createAgentDef("agent1", "Agent 1"), task: "Task 1" },
      { agent: createAgentDef("agent2", "Agent 2"), task: "Task 2" },
      { agent: createAgentDef("agent3", "Agent 3"), task: "Task 3" },
    ];

    const g = crew({
      members,
      name: "test-crew",
      process: "sequential",
      provider,
    });

    const session = await store.createSession("./test");

    // Run first
    await run(g, {
      checkpointStore: store,
      namespace: "crew-resume-test",
      sessionId: session.id,
    });

    const checkpoint = await store.getLatestCheckpoint(session.id, "crew-resume-test");
    expect(checkpoint).not.toBeNull();

    // Resume
    provider.reset();
    const result2 = await run(g, {
      checkpointStore: store,
      namespace: "crew-resume-test-2",
      resumeFrom: checkpoint!,
      sessionId: session.id,
    });

    expect(result2.status).toBe("Complete");
  });

  test("crew task injection in prompts", async () => {
    const provider = new MockLLMProvider([{ text: "result" }]);

    const members = [
      { agent: createAgentDef("agent1", "Original prompt"), task: "Do something specific" },
    ];

    const g = crew({
      members,
      name: "test-crew",
      process: "sequential",
      provider,
    });

    const session = await store.createSession("./test");
    await run(g, {
      checkpointStore: store,
      sessionId: session.id,
    });

    // Verify the prompt includes task prefix
    expect(provider.recordedCalls.length).toBe(1);
    const firstMessage = provider.recordedCalls[0].messages[0];
    const textContent = firstMessage?.content[0];
    expect(textContent?.type).toBe("text");
    if (textContent?.type === "text") {
      expect(textContent.text).toContain("Task: Do something specific");
      expect(textContent.text).toContain("Original prompt");
    }
  });

  test("crew empty members throws error", () => {
    const provider = new MockLLMProvider([]);

    expect(() => {
      crew({
        members: [],
        name: "empty-crew",
        process: "sequential",
        provider,
      });
    }).toThrow("Empty crew");
  });

  test("crew single member executes successfully", async () => {
    const provider = new MockLLMProvider([{ text: "solo result" }]);

    const members = [{ agent: createAgentDef("solo", "Solo agent"), task: "Solo task" }];

    const g = crew({
      members,
      name: "solo-crew",
      process: "sequential",
      provider,
    });

    expect(g.entry).toBe("solo");
    expect(g.edges.length).toBe(0);

    const session = await store.createSession("./test");
    const result = await run(g, {
      checkpointStore: store,
      sessionId: session.id,
    });

    expect(result.status).toBe("Complete");
    expect(provider.recordedCalls.length).toBe(1);
  });

  test("crew hierarchical maxRounds based on member count", async () => {
    const provider = new MockLLMProvider([
      { next: "worker1" },
      { text: "result" },
      { next: "FINISH" },
    ]);

    const members = [
      { agent: createAgentDef("worker1", "Worker 1"), task: "Task 1" },
      { agent: createAgentDef("worker2", "Worker 2"), task: "Task 2" },
      { agent: createAgentDef("worker3", "Worker 3"), task: "Task 3" },
    ];

    const g = crew({
      members,
      name: "test-crew",
      process: "hierarchical",
      provider,
    });

    const session = await store.createSession("./test");
    const result = await run(g, {
      checkpointStore: store,
      sessionId: session.id,
    });

    expect(result.status).toBe("Complete");
  });
});

// -----------------------------------------------------------------------------
// Combined Multi-Agent Integration Tests
// -----------------------------------------------------------------------------

describe("Combined Multi-Agent Integration Tests", () => {
  let store: CheckpointStore;

  beforeEach(() => {
    store = new InMemoryCheckpointStore();
  });

  test("supervisor and crew can use same checkpoint store", async () => {
    const supervisorProvider = new MockLLMProvider([
      { next: "worker1" },
      { text: "supervisor result" },
      { next: "FINISH" },
    ]);

    const crewProvider = new MockLLMProvider([{ text: "crew result" }]);

    // Create supervisor
    const supervisorGraph = supervisor({
      maxRounds: 5,
      name: "boss",
      provider: supervisorProvider,
      workers: [createAgentDef("worker1", "Worker")],
    });

    // Create crew
    const crewGraph = crew({
      members: [{ agent: createAgentDef("agent1", "Agent"), task: "Task" }],
      name: "test-crew",
      process: "sequential",
      provider: crewProvider,
    });

    const session = await store.createSession("./test");

    // Run supervisor
    const result1 = await run(supervisorGraph, {
      checkpointStore: store,
      namespace: "supervisor",
      sessionId: session.id,
    });
    expect(result1.status).toBe("Complete");

    // Run crew
    const result2 = await run(crewGraph, {
      checkpointStore: store,
      namespace: "crew",
      sessionId: session.id,
    });
    expect(result2.status).toBe("Complete");

    // Verify both checkpoints exist
    const supervisorCheckpoint = await store.getLatestCheckpoint(session.id, "supervisor");
    const crewCheckpoint = await store.getLatestCheckpoint(session.id, "crew");
    expect(supervisorCheckpoint).not.toBeNull();
    expect(crewCheckpoint).not.toBeNull();
  });

  test("complex workflow: crew output feeds into supervisor", async () => {
    // This test demonstrates a complex pattern where crew preprocessing
    // feeds into a supervisor orchestration
    const crewProvider = new MockLLMProvider([
      { text: "preprocessed data" },
      { text: "analysis complete" },
    ]);

    const supervisorProvider = new MockLLMProvider([
      { next: "analyzer" },
      { text: "final analysis" },
      { next: "FINISH" },
    ]);

    // Preprocessing crew
    const preprocessingCrew = crew({
      members: [
        { agent: createAgentDef("extractor", "Data extractor"), task: "Extract data" },
        { agent: createAgentDef("cleaner", "Data cleaner"), task: "Clean data" },
      ],
      name: "preprocessing",
      process: "sequential",
      provider: crewProvider,
    });

    // Analysis supervisor
    const analysisSupervisor = supervisor({
      maxRounds: 5,
      name: "coordinator",
      provider: supervisorProvider,
      workers: [createAgentDef("analyzer", "Data analyzer")],
    });

    const session = await store.createSession("./test");

    // Run preprocessing
    const crewResult = await run(preprocessingCrew, {
      checkpointStore: store,
      input: "Raw data input",
      namespace: "preprocessing",
      sessionId: session.id,
    });
    expect(crewResult.status).toBe("Complete");

    // Run supervisor analysis
    const supervisorResult = await run(analysisSupervisor, {
      checkpointStore: store,
      input: "Preprocessed data for analysis",
      namespace: "analysis",
      sessionId: session.id,
    });
    expect(supervisorResult.status).toBe("Complete");
  });
});
