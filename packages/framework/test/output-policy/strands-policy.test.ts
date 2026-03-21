import { describe, expect, test } from "bun:test";

import {
  applyPolicy,
  createPolicyEmitter,
  type OutputPolicy,
  wrapAsyncIterable,
  wrapCallback,
} from "../../src/output-policy";
import type {
  AgentCompleteEvent,
  AgentErrorEvent,
  AgentEvent,
  GraphInterruptEvent,
  GraphNodeFailedEvent,
  GuardrailInputBlockedEvent,
  GuardrailOutputBlockedEvent,
  ParseErrorEvent,
  SessionEndEvent,
  SessionStartEvent,
  StreamChunkEvent,
  StreamEndEvent,
  StreamStartEvent,
  SupervisorWorkerOutputEvent,
  ToolCallEvent,
  ToolProgressEvent,
  ToolResultEvent,
  ToolStreamChunkEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "../../src/types/events";

type StrandsPayload =
  | { messageStart: { role: "assistant" } }
  | { contentBlockStart: { contentBlockIndex: number; start: { text: "" } } }
  | {
      contentBlockStart: {
        contentBlockIndex: number;
        start: { toolUse: { name: string; toolUseId: string } };
      };
    }
  | { contentBlockDelta: { contentBlockIndex: number; delta: { text: string } } }
  | {
      contentBlockDelta: {
        contentBlockIndex: number;
        delta: { toolUse: { input: string } };
      };
    }
  | { contentBlockStop: { contentBlockIndex: number } }
  | { messageStop: { stopReason: "end_turn" | "error" | "interrupt" | "content_filtered" } }
  | {
      metadata: {
        usage: {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        };
      };
    };

function createStrandsPolicy(): OutputPolicy<AgentEvent, StrandsPayload | undefined> {
  let nextContentBlockIndex = 0;
  let activeTextBlockIndex: number | undefined;
  const toolBlockIndexes = new Map<string, number>();
  let lastToolBlockIndex: number | undefined;

  return {
    emit({ event }) {
      switch (event.type) {
        case "session.start":
        case "agent.transition":
        case "tool.progress":
        case "graph.node.start":
        case "graph.node.complete":
        case "graph.cycle.start":
        case "graph.cycle.complete":
        case "supervisor.routing":
        case "checkpoint.saved":
        case "memory.load":
        case "memory.save":
        case "handoff.start":
        case "handoff.complete":
        case "context.pruned":
        case "context.compacted":
        case "hook.error":
        case "bg.task.started":
        case "bg.task.completed":
        case "bg.task.failed":
        case "bg.task.timeout":
          return undefined;
        case "turn.start":
          return { messageStart: { role: "assistant" } };
        case "turn.end":
          return { messageStop: { stopReason: "end_turn" } };
        case "session.end":
          return {
            messageStop: {
              stopReason:
                event.status === "failed"
                  ? "error"
                  : event.status === "interrupted"
                    ? "interrupt"
                    : "end_turn",
            },
          };
        case "stream.start": {
          const contentBlockIndex = nextContentBlockIndex++;
          activeTextBlockIndex = contentBlockIndex;
          return {
            contentBlockStart: {
              contentBlockIndex,
              start: { text: "" },
            },
          };
        }
        case "stream.chunk":
        case "agent.thinking":
        case "supervisor.worker.output":
          return {
            contentBlockDelta: {
              contentBlockIndex: activeTextBlockIndex ?? 0,
              delta: { text: getTextDelta(event) },
            },
          };
        case "stream.end": {
          const contentBlockIndex = activeTextBlockIndex ?? 0;
          activeTextBlockIndex = undefined;
          return { contentBlockStop: { contentBlockIndex } };
        }
        case "tool.call": {
          const contentBlockIndex = nextContentBlockIndex++;
          toolBlockIndexes.set(event.toolUseId, contentBlockIndex);
          lastToolBlockIndex = contentBlockIndex;
          return {
            contentBlockStart: {
              contentBlockIndex,
              start: {
                toolUse: {
                  name: event.toolName,
                  toolUseId: event.toolUseId,
                },
              },
            },
          };
        }
        case "tool.stream.chunk":
          return {
            contentBlockDelta: {
              contentBlockIndex: lastToolBlockIndex ?? 0,
              delta: { toolUse: { input: JSON.stringify(event.chunk) } },
            },
          };
        case "tool.result": {
          const contentBlockIndex =
            toolBlockIndexes.get(event.toolUseId) ?? lastToolBlockIndex ?? 0;
          toolBlockIndexes.delete(event.toolUseId);
          return { contentBlockStop: { contentBlockIndex } };
        }
        case "agent.complete":
          return {
            metadata: {
              usage: {
                inputTokens: event.usage?.totalInputTokens ?? 0,
                outputTokens: event.usage?.totalOutputTokens ?? 0,
                totalTokens:
                  (event.usage?.totalInputTokens ?? 0) + (event.usage?.totalOutputTokens ?? 0),
              },
            },
          };
        case "agent.error":
        case "graph.node.failed":
        case "supervisor.finish":
        case "supervisor.routing.failed":
        case "parse.error":
          return { messageStop: { stopReason: "error" } };
        case "graph.interrupt":
          return { messageStop: { stopReason: "interrupt" } };
        case "guardrail.input.blocked":
        case "guardrail.output.blocked":
          return { messageStop: { stopReason: "content_filtered" } };
      }
    },
  };
}

function getTextDelta(
  event:
    | StreamChunkEvent
    | Extract<AgentEvent, { type: "agent.thinking" }>
    | SupervisorWorkerOutputEvent
): string {
  switch (event.type) {
    case "stream.chunk":
    case "agent.thinking":
      return event.content;
    case "supervisor.worker.output":
      return event.output;
  }
}

async function collectAsync(
  events: AgentEvent[],
  surface: "callback" | "iterable" | "transport"
): Promise<StrandsPayload[]> {
  async function* stream(): AsyncIterable<AgentEvent> {
    for (const event of events) {
      yield event;
    }
  }

  const outputs: StrandsPayload[] = [];
  for await (const payload of wrapAsyncIterable(stream(), createStrandsPolicy(), surface)) {
    if (payload !== undefined) outputs.push(payload);
  }
  return outputs;
}

describe("strands policy", () => {
  test("applyPolicy maps MAP rules to strands wire payloads on transport surface", () => {
    const policy = createStrandsPolicy();

    const messageStart = applyPolicy(turnStartEvent(), policy, { surface: "transport" });
    const contentBlockStart = applyPolicy(streamStartEvent(), policy, { surface: "transport" });
    const contentBlockDelta = applyPolicy(streamChunkEvent("hello"), policy, {
      surface: "transport",
    });
    const thinkingDelta = applyPolicy(agentThinkingEvent("reasoning"), policy, {
      surface: "transport",
    });
    const contentBlockStop = applyPolicy(streamEndEvent(), policy, { surface: "transport" });
    const metadataPayload = applyPolicy(agentCompleteEvent(), policy, { surface: "transport" });

    expect(messageStart).toEqual({ messageStart: { role: "assistant" } });
    expect(contentBlockStart).toEqual({
      contentBlockStart: { contentBlockIndex: 0, start: { text: "" } },
    });
    expect(contentBlockDelta).toEqual({
      contentBlockDelta: { contentBlockIndex: 0, delta: { text: "hello" } },
    });
    expect(thinkingDelta).toEqual({
      contentBlockDelta: { contentBlockIndex: 0, delta: { text: "reasoning" } },
    });
    expect(contentBlockStop).toEqual({ contentBlockStop: { contentBlockIndex: 0 } });
    expect(metadataPayload).toEqual({
      metadata: { usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 } },
    });
  });

  test("createPolicyEmitter folds completion events to messageStop stopReason values", () => {
    const emit = createPolicyEmitter(createStrandsPolicy(), "transport");

    const cases: Array<[string, AgentEvent, StrandsPayload]> = [
      ["turn.end", turnEndEvent(), { messageStop: { stopReason: "end_turn" } }],
      [
        "session.end complete",
        sessionEndEvent("complete"),
        { messageStop: { stopReason: "end_turn" } },
      ],
      ["session.end failed", sessionEndEvent("failed"), { messageStop: { stopReason: "error" } }],
      ["agent.error", agentErrorEvent(), { messageStop: { stopReason: "error" } }],
      ["graph.node.failed", graphNodeFailedEvent(), { messageStop: { stopReason: "error" } }],
      ["parse.error", parseErrorEvent(), { messageStop: { stopReason: "error" } }],
      [
        "session.end interrupted",
        sessionEndEvent("interrupted"),
        { messageStop: { stopReason: "interrupt" } },
      ],
      ["graph.interrupt", graphInterruptEvent(), { messageStop: { stopReason: "interrupt" } }],
      [
        "guardrail.input.blocked",
        guardrailInputBlockedEvent(),
        { messageStop: { stopReason: "content_filtered" } },
      ],
      [
        "guardrail.output.blocked",
        guardrailOutputBlockedEvent(),
        { messageStop: { stopReason: "content_filtered" } },
      ],
    ];

    for (const [, event, expected] of cases) {
      expect(emit(event)).toEqual(expected);
    }
  });

  test("wrapCallback emits tool use flow with toolUse payloads and metadata on callback surface", () => {
    const outputs: StrandsPayload[] = [];
    const onEvent = wrapCallback<AgentEvent, StrandsPayload | undefined, void>(
      (payload) => {
        if (payload !== undefined) outputs.push(payload);
      },
      createStrandsPolicy(),
      "callback"
    );

    onEvent(toolCallEvent());
    onEvent(toolStreamChunkEvent());
    onEvent(toolResultEvent());
    onEvent(agentCompleteEvent());

    expect(outputs).toEqual([
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { toolUse: { name: "search", toolUseId: "toolu_123" } },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: '{"query":"obsku"}' } },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      {
        metadata: {
          usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
        },
      },
    ]);
  });

  test("wrapAsyncIterable drops unsupported events and preserves strands sequence on iterable surface", async () => {
    const outputs = await collectAsync(
      [
        sessionStartEvent(),
        turnStartEvent(),
        streamStartEvent(),
        streamChunkEvent("hello"),
        supervisorWorkerOutputEvent(),
        toolProgressEvent(),
        streamEndEvent(),
      ],
      "iterable"
    );

    expect(outputs).toEqual([
      { messageStart: { role: "assistant" } },
      { contentBlockStart: { contentBlockIndex: 0, start: { text: "" } } },
      { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "hello" } } },
      { contentBlockDelta: { contentBlockIndex: 0, delta: { text: "worker delta" } } },
      { contentBlockStop: { contentBlockIndex: 0 } },
    ]);
  });
});

function sessionStartEvent(): SessionStartEvent {
  return { type: "session.start", timestamp: 1, input: "hello", sessionId: "session-1" };
}

function sessionEndEvent(status: SessionEndEvent["status"]): SessionEndEvent {
  return { type: "session.end", timestamp: 2, sessionId: "session-1", status, turns: 1 };
}

function turnStartEvent(): TurnStartEvent {
  return { type: "turn.start", timestamp: 3, turn: 1, turnId: "turn-1", phase: "planning" };
}

function turnEndEvent(): TurnEndEvent {
  return { type: "turn.end", timestamp: 4, turn: 1, turnId: "turn-1", status: "completed" };
}

function streamStartEvent(): StreamStartEvent {
  return { type: "stream.start", timestamp: 5, turn: 1, turnId: "turn-1" };
}

function streamChunkEvent(content: string): StreamChunkEvent {
  return { type: "stream.chunk", timestamp: 6, content, phase: "planning" };
}

function streamEndEvent(): StreamEndEvent {
  return { type: "stream.end", timestamp: 7, turn: 1, turnId: "turn-1" };
}

function agentThinkingEvent(content: string): Extract<AgentEvent, { type: "agent.thinking" }> {
  return { type: "agent.thinking", timestamp: 8, content };
}

function agentCompleteEvent(): AgentCompleteEvent {
  return {
    type: "agent.complete",
    timestamp: 9,
    summary: "done",
    usage: { llmCalls: 1, totalInputTokens: 5, totalOutputTokens: 7 },
  };
}

function agentErrorEvent(): AgentErrorEvent {
  return { type: "agent.error", timestamp: 10, message: "boom" };
}

function toolCallEvent(): ToolCallEvent {
  return {
    type: "tool.call",
    timestamp: 11,
    toolName: "search",
    toolUseId: "toolu_123",
    args: { query: "obsku" },
  };
}

function toolStreamChunkEvent(): ToolStreamChunkEvent {
  return {
    type: "tool.stream.chunk",
    timestamp: 12,
    toolName: "search",
    chunk: { query: "obsku" },
  };
}

function toolResultEvent(): ToolResultEvent {
  return {
    type: "tool.result",
    timestamp: 13,
    toolName: "search",
    toolUseId: "toolu_123",
    result: { matches: 1 },
  };
}

function toolProgressEvent(): ToolProgressEvent {
  return {
    type: "tool.progress",
    timestamp: 14,
    toolName: "search",
    toolUseId: "toolu_123",
    status: "running",
    percent: 50,
  };
}

function graphNodeFailedEvent(): GraphNodeFailedEvent {
  return { type: "graph.node.failed", timestamp: 15, nodeId: "planner", error: "boom" };
}

function graphInterruptEvent(): GraphInterruptEvent {
  return {
    type: "graph.interrupt",
    timestamp: 16,
    nodeId: "planner",
    reason: "human review",
    requiresInput: true,
  };
}

function supervisorWorkerOutputEvent(): SupervisorWorkerOutputEvent {
  return {
    type: "supervisor.worker.output",
    timestamp: 17,
    worker: "worker-1",
    round: 1,
    output: "worker delta",
  };
}

function guardrailInputBlockedEvent(): GuardrailInputBlockedEvent {
  return { type: "guardrail.input.blocked", timestamp: 18, reason: "blocked" };
}

function guardrailOutputBlockedEvent(): GuardrailOutputBlockedEvent {
  return { type: "guardrail.output.blocked", timestamp: 19, reason: "blocked" };
}

function parseErrorEvent(): ParseErrorEvent {
  return { type: "parse.error", timestamp: 20, error: "bad json" };
}
