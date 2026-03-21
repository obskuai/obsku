import type { AgentEvent, OutputPolicy, OutputPolicyInput } from "@obsku/framework";
import {
  contentBlockDelta,
  contentBlockStart,
  contentBlockStop,
  messageStart,
  messageStop,
  metadata,
  toolUseContentBlockDelta,
  toolUseContentBlockStart,
} from "./strands-sse";

export type StrandsPublicPayload = string | null;

type StrandsStopReason = "content_filtered" | "end_turn" | "error" | "interrupt";

type ActiveBlock =
  | { index: number; kind: "text" }
  | { index: number; kind: "tool"; toolUseId: string };

function toToolInput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function toStopReason(event: AgentEvent): StrandsStopReason | undefined {
  switch (event.type) {
    case "turn.end":
    case "supervisor.finish":
      return "end_turn";
    case "session.end":
      switch (event.status) {
        case "failed":
          return "error";
        case "interrupted":
          return "interrupt";
        case "complete":
        default:
          return "end_turn";
      }
    case "agent.error":
    case "graph.node.failed":
    case "supervisor.routing.failed":
    case "parse.error":
      return "error";
    case "graph.interrupt":
      return "interrupt";
    case "guardrail.input.blocked":
    case "guardrail.output.blocked":
      return "content_filtered";
    default:
      return undefined;
  }
}

function toUsage(event: Extract<AgentEvent, { type: "agent.complete" }>) {
  if (!event.usage) {
    return undefined;
  }

  const inputTokens = event.usage.totalInputTokens;
  const outputTokens = event.usage.totalOutputTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function createStrandsPolicy(): OutputPolicy<AgentEvent, StrandsPublicPayload> {
  let nextBlockIndex = 0;
  let activeBlock: ActiveBlock | undefined;

  const closeActiveBlock = (): string | null => {
    if (!activeBlock) {
      return null;
    }

    const payload = contentBlockStop(activeBlock.index);
    activeBlock = undefined;
    nextBlockIndex += 1;
    return payload;
  };

  const openTextBlock = (): string => {
    const index = nextBlockIndex;
    activeBlock = { index, kind: "text" };
    return contentBlockStart(index);
  };

  return {
    emit({ event }: OutputPolicyInput<AgentEvent>): StrandsPublicPayload {
      switch (event.type) {
        case "turn.start":
          nextBlockIndex = 0;
          activeBlock = undefined;
          return messageStart();
        case "stream.start":
          if (activeBlock?.kind === "text") {
            return null;
          }

          return openTextBlock();
        case "stream.chunk":
        case "agent.thinking":
          if (activeBlock?.kind !== "text") {
            return null;
          }

          return contentBlockDelta(activeBlock.index, event.content);
        case "stream.end":
          return activeBlock?.kind === "text" ? closeActiveBlock() : null;
        case "tool.call": {
          const index = nextBlockIndex;
          activeBlock = { index, kind: "tool", toolUseId: event.toolUseId };
          return toolUseContentBlockStart(index, event.toolUseId, event.toolName);
        }
        case "tool.stream.chunk":
          if (activeBlock?.kind !== "tool") {
            return null;
          }

          return toolUseContentBlockDelta(activeBlock.index, toToolInput(event.chunk));
        case "tool.result":
          if (activeBlock?.kind !== "tool" || activeBlock.toolUseId !== event.toolUseId) {
            return null;
          }

          return closeActiveBlock();
        case "agent.complete": {
          const usage = toUsage(event);
          return usage ? metadata(usage) : null;
        }
        case "supervisor.worker.output":
          if (activeBlock?.kind !== "text") {
            return null;
          }

          return contentBlockDelta(activeBlock.index, event.output);
        default: {
          const stopReason = toStopReason(event);
          return stopReason ? messageStop(stopReason) : null;
        }
      }
    },
  };
}

export const strandsPolicy = createStrandsPolicy();
