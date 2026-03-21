import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { agent } from "../../src/agent";
import { TaskManager } from "../../src/background";
import { graph } from "../../src/graph/builder";
import { executeGraph } from "../../src/graph/executor";
import { supervisor } from "../../src/multi-agent/supervisor";
import { type DefaultPublicPayload, defaultPolicy } from "../../src/output-policy";
import { plugin } from "../../src/plugin";
import { run } from "../../src/runtime";
import type { AgentEvent, LLMProvider, Message } from "../../src/types";
import { mockLLMProvider } from "../utils/mock-llm-provider";

function expectDefaultPayload(
  event: DefaultPublicPayload<AgentEvent>,
  type: AgentEvent["type"],
  data: Record<string, unknown>
): void {
  expect(Object.keys(event).sort()).toEqual(["data", "timestamp", "type"]);
  expect(event.type).toBe(type);
  expect(event.timestamp).toEqual(expect.any(Number));
  expect(event.data).toEqual(data);
  expect(event.data).not.toHaveProperty("type");
  expect(event.data).not.toHaveProperty("timestamp");
}

function createStreamingTestAgent() {
  return agent({
    name: "default-policy-agent",
    prompt: "Use the available tool, then answer.",
    streaming: true,
    tools: [
      plugin({
        description: "Echo text",
        name: "echo",
        params: z.object({ text: z.string() }),
        run: async ({ text }) => text,
      }),
    ],
  });
}

function createToolStreamingProvider(): LLMProvider {
  let callCount = 0;

  return {
    chat: async () => ({
      content: [{ text: "unused", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
    chatStream: async function* () {
      callCount += 1;

      if (callCount === 1) {
        yield { name: "echo", toolUseId: "toolu_default_policy", type: "tool_use_start" };
        yield { input: '{"text":"mock_value"}', type: "tool_use_delta" };
        yield { type: "tool_use_end" };
        yield {
          stopReason: "tool_use",
          type: "message_end",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
        return;
      }

      yield { content: "Mock ", type: "text_delta" };
      yield { content: "response to your message.", type: "text_delta" };
      yield {
        stopReason: "end_turn",
        type: "message_end",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
    contextWindowSize: 200_000,
  };
}

async function nextMatching(
  iterator: AsyncIterator<DefaultPublicPayload<AgentEvent>>,
  predicate: (event: DefaultPublicPayload<AgentEvent>) => boolean
): Promise<DefaultPublicPayload<AgentEvent>> {
  while (true) {
    const next = await iterator.next();
    if (next.done) {
      throw new Error("subscription ended early");
    }
    if (predicate(next.value)) {
      return next.value;
    }
  }
}

async function waitFor<T>(getValue: () => T | undefined, timeoutMs = 500): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = getValue();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("timed out waiting for value");
}

function getEventByType<TType extends AgentEvent["type"]>(
  events: Array<DefaultPublicPayload<AgentEvent>>,
  type: TType
): DefaultPublicPayload<Extract<AgentEvent, { type: TType }>> | undefined {
  return events.find(
    (event): event is DefaultPublicPayload<Extract<AgentEvent, { type: TType }>> =>
      event.type === type
  );
}

describe("defaultPolicy", () => {
  test("preserves canonical fields across representative event types", () => {
    const events = [
      {
        args: { query: "obsku" },
        timestamp: 1710000000000,
        toolName: "search",
        toolUseId: "toolu_123",
        type: "tool.call" as const,
      },
      {
        content: "chunk-1",
        phase: "executing" as const,
        timestamp: 1710000000001,
        type: "stream.chunk" as const,
      },
      {
        content: "thinking...",
        timestamp: 1710000000002,
        type: "agent.thinking" as const,
      },
    ] satisfies Array<AgentEvent>;

    for (const canonicalEvent of events) {
      const { timestamp, type, ...data } = canonicalEvent;
      const payload = defaultPolicy.emit({
        context: { surface: "callback" },
        event: canonicalEvent,
      });

      expect(payload).toEqual({ data, timestamp, type });
      expectDefaultPayload(payload, type, data);
    }
  });

  test("wraps subscribe() output in the default public payload shape", async () => {
    const provider = createToolStreamingProvider();
    const testAgent = createStreamingTestAgent();
    const sessionId = "default-policy-subscribe";
    const subscription = await testAgent.subscribe({ sessionId });
    const iterator = subscription[Symbol.asyncIterator]() as AsyncIterator<
      DefaultPublicPayload<AgentEvent>
    >;

    const runPromise = testAgent.run("say hi", provider, { sessionId });
    const toolCall = (await nextMatching(
      iterator,
      (event) => event.type === "tool.call"
    )) as DefaultPublicPayload<Extract<AgentEvent, { type: "tool.call" }>>;
    const toolResult = (await nextMatching(
      iterator,
      (event) => event.type === "tool.result"
    )) as DefaultPublicPayload<Extract<AgentEvent, { type: "tool.result" }>>;
    const streamChunk = (await nextMatching(
      iterator,
      (event) => event.type === "stream.chunk"
    )) as DefaultPublicPayload<Extract<AgentEvent, { type: "stream.chunk" }>>;

    await expect(runPromise).resolves.toBe("Mock response to your message.");
    expectDefaultPayload(toolCall, "tool.call", {
      args: { text: "mock_value" },
      toolName: "echo",
      toolUseId: toolCall.data.toolUseId,
    });
    expectDefaultPayload(toolResult, "tool.result", {
      isError: false,
      result: "mock_value",
      toolName: "echo",
      toolUseId: toolResult.data.toolUseId,
    });
    expectDefaultPayload(streamChunk, "stream.chunk", {
      content: "Mock ",
      phase: "executing",
    });

    await iterator.return?.();
  });

  test("wraps onEvent callback output in the default public payload shape", async () => {
    const provider = createToolStreamingProvider();
    const events: Array<DefaultPublicPayload<AgentEvent>> = [];

    await expect(
      createStreamingTestAgent().run("say hi", provider, {
        onEvent: (event) => events.push(event as unknown as DefaultPublicPayload<AgentEvent>),
      })
    ).resolves.toBe("Mock response to your message.");

    const toolCall = getEventByType(events, "tool.call");
    const toolResult = getEventByType(events, "tool.result");
    const streamChunk = getEventByType(events, "stream.chunk");

    expect(toolCall).toBeDefined();
    expect(toolResult).toBeDefined();
    expect(streamChunk).toBeDefined();

    expectDefaultPayload(toolCall!, "tool.call", {
      args: { text: "mock_value" },
      toolName: "echo",
      toolUseId: toolCall!.data.toolUseId,
    });
    expectDefaultPayload(toolResult!, "tool.result", {
      isError: false,
      result: "mock_value",
      toolName: "echo",
      toolUseId: toolResult!.data.toolUseId,
    });
    expectDefaultPayload(streamChunk!, "stream.chunk", {
      content: "Mock ",
      phase: "executing",
    });
  });

  test("wraps runtime callback output in the default public payload shape", async () => {
    const provider = mockLLMProvider();
    const events: Array<DefaultPublicPayload<AgentEvent>> = [];
    const g = graph({
      edges: [],
      entry: "runtime-node",
      nodes: [{ executor: async (input) => input ?? "done", id: "runtime-node" }],
      provider,
    });

    await run(g, {
      input: "runtime-input",
      onEvent: (event) => events.push(event),
      sessionId: "runtime-session",
    });

    const sessionStart = getEventByType(events, "session.start");
    expect(sessionStart).toBeDefined();
    expectDefaultPayload(sessionStart!, "session.start", {
      input: "runtime-input",
      sessionId: "runtime-session",
    });
  });

  test("wraps graph executor callback output in the default public payload shape", async () => {
    const events: Array<DefaultPublicPayload<AgentEvent>> = [];
    const g = graph({
      edges: [],
      entry: "graph-node",
      nodes: [{ executor: async () => "graph-output", id: "graph-node" }],
      provider: mockLLMProvider(),
    });

    await executeGraph(g, (event) => events.push(event));

    const nodeStart = getEventByType(events, "graph.node.start");
    expect(nodeStart).toBeDefined();
    expectDefaultPayload(nodeStart!, "graph.node.start", { nodeId: "graph-node" });
  });

  test("wraps supervisor callback output in the default public payload shape", async () => {
    const events: Array<DefaultPublicPayload<AgentEvent>> = [];
    const provider: LLMProvider = {
      chat: async (_messages: Array<Message>) => ({
        content: [{ text: '{"next":"FINISH"}', type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
      chatStream: async function* () {},
      contextWindowSize: 200_000,
    };
    const g = supervisor({
      name: "boss",
      onEvent: (event) => events.push(event),
      provider,
      workers: [{ name: "worker", prompt: "Do work" }],
    });
    const node = g.nodes.get("boss");
    expect(node).toBeDefined();
    expect(typeof node?.executor).toBe("function");

    const executor = node?.executor;
    if (typeof executor !== "function") {
      throw new Error("expected supervisor node executor to be callable");
    }

    await executor("route this");

    const routing = getEventByType(events, "supervisor.routing");
    expect(routing).toBeDefined();
    expectDefaultPayload(routing!, "supervisor.routing", { next: "FINISH", round: 0 });
  });

  test("wraps background task callback output in the default public payload shape", async () => {
    const events: Array<DefaultPublicPayload<AgentEvent>> = [];
    const taskManager = new TaskManager({ onEvent: (event) => events.push(event) });
    const taskId = taskManager.start("bg-tool", async () => "done");

    const completed = await waitFor(() => getEventByType(events, "bg.task.completed"));

    expectDefaultPayload(completed, "bg.task.completed", {
      duration: completed.data.duration,
      taskId,
      toolName: "bg-tool",
    });
  });
});
