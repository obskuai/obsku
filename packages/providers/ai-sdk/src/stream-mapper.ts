/**
 * Maps AI SDK stream events to obsku LLMStreamEvent format.
 */

import type { LLMStreamEvent } from "@obsku/framework";
import type { FinishReason, LanguageModelUsage, TextStreamPart, ToolSet } from "ai";
import { mapAiSdkError } from "./errors.js";
import { mapAiSdkStopReason } from "./stop-reason.js";

/**
 * Map AI SDK TextStreamPart events to obsku LLMStreamEvent.
 *
 * Event mappings:
 * - `text-delta` → `{ type: "text_delta", content }`
 * - `tool-call` → yields 3 events: tool_use_start, tool_use_delta, tool_use_end
 * - `finish` → `{ type: "message_end", stopReason, usage }`
 * - `error` → throws mapped ProviderError
 *
 * Ignored events (not mapped):
 * - `reasoning`, `reasoning-signature`, `redacted-reasoning` (extended thinking)
 * - `source`, `file` (citations/files)
 * - `tool-call-streaming-start`, `tool-call-delta` (streaming tool args - we use final tool-call)
 * - `tool-result` (tool execution results - handled by framework)
 * - `step-start`, `step-finish` (step-level events - we use final finish only)
 */
export async function* mapStreamEvents<TOOLS extends ToolSet>(
  fullStream: AsyncIterable<TextStreamPart<TOOLS>>
): AsyncIterable<LLMStreamEvent> {
  for await (const event of fullStream) {
    switch (event.type) {
      case "text-delta":
        yield { type: "text_delta", content: event.textDelta };
        break;

      case "tool-call": {
        // Yield 3 events in sequence for tool use
        yield {
          type: "tool_use_start",
          name: event.toolName,
          toolUseId: event.toolCallId,
        };
        yield {
          type: "tool_use_delta",
          input: JSON.stringify(event.args),
        };
        yield { type: "tool_use_end" };
        break;
      }

      case "finish": {
        const usage = event.usage as LanguageModelUsage | undefined;
        yield {
          type: "message_end",
          stopReason: mapAiSdkStopReason(event.finishReason),
          usage: {
            inputTokens: usage?.promptTokens ?? 0,
            outputTokens: usage?.completionTokens ?? 0,
          },
        };
        break;
      }

      case "error":
        throw mapAiSdkError(event.error);

      // Ignored events - not relevant for obsku streaming
      case "reasoning":
      case "reasoning-signature":
      case "redacted-reasoning":
      case "source":
      case "file":
      case "tool-call-streaming-start":
      case "tool-call-delta":
      case "tool-result":
      case "step-start":
      case "step-finish":
        // Skip these events
        break;

      default:
        // Unknown event type - skip
        break;
    }
  }
}
