import type { ConverseStreamOutput } from "@aws-sdk/client-bedrock-runtime";
import type { LLMStreamEvent } from "@obsku/framework";

export function mapStreamEvent(event: ConverseStreamOutput): Array<LLMStreamEvent> {
  if (event.contentBlockDelta) {
    const delta = event.contentBlockDelta.delta;
    if (delta?.text !== undefined) {
      return [{ content: delta.text, type: "text_delta" }];
    }
    if (delta?.toolUse) {
      return [{ input: delta.toolUse.input ?? "", type: "tool_use_delta" }];
    }
  }
  if (event.contentBlockStart?.start?.toolUse) {
    const toolUse = event.contentBlockStart.start.toolUse;
    return [
      {
        name: toolUse.name ?? "",
        toolUseId: toolUse.toolUseId ?? "",
        type: "tool_use_start",
      },
    ];
  }
  if (event.contentBlockStop) {
    return [{ type: "tool_use_end" }];
  }
  if (event.metadata) {
    return [
      {
        stopReason: "end_turn",
        type: "message_end",
        usage: {
          inputTokens: event.metadata.usage?.inputTokens ?? 0,
          outputTokens: event.metadata.usage?.outputTokens ?? 0,
        },
      },
    ];
  }
  if (event.messageStop) {
    return [
      {
        stopReason: event.messageStop.stopReason ?? "end_turn",
        type: "message_end",
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    ];
  }
  return [];
}
