import type { LLMResponse, LLMStreamEvent } from "../../src/types";

export function textResponse(text: string): LLMResponse {
  return {
    content: [{ text, type: "text" }],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

export function toolResponse(
  calls: Array<{ id: string; input?: Record<string, unknown>; name: string }>
): LLMResponse {
  return {
    content: calls.map((c) => ({
      input: c.input ?? {},
      name: c.name,
      toolUseId: c.id,
      type: "tool_use" as const,
    })),
    stopReason: "tool_use",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

export function mixedResponse(
  text: string,
  calls: Array<{ id: string; input?: Record<string, unknown>; name: string }>
): LLMResponse {
  return {
    content: [
      { text, type: "text" as const },
      ...calls.map((c) => ({
        input: c.input ?? {},
        name: c.name,
        toolUseId: c.id,
        type: "tool_use" as const,
      })),
    ],
    stopReason: "tool_use",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

export async function* textStream(chunks: Array<string>): AsyncIterable<LLMStreamEvent> {
  for (const chunk of chunks) {
    yield { content: chunk, type: "text_delta" };
  }
  yield {
    stopReason: "end_turn",
    type: "message_end",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

export async function* toolUseStream(
  toolUseId: string,
  name: string,
  input: Record<string, unknown>
): AsyncIterable<LLMStreamEvent> {
  yield { name, toolUseId, type: "tool_use_start" };
  yield { input: JSON.stringify(input), type: "tool_use_delta" };
  yield { type: "tool_use_end" };
  yield {
    stopReason: "tool_use",
    type: "message_end",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}
