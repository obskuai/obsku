import { BlockType, MessageRole } from "../types/constants";
import type { Message } from "../types/llm";
import type { StoredMessage } from "./types";

type TransientMemoryMessage = Message & { __obskuTransientMemoryInjection?: true };
const MEMORY_MARKER_START = "[MEMORY_INJECTION]";

export function toCheckpointPayloads(
  messages: Array<Message>,
  sessionId: string
): Array<Omit<StoredMessage, "id" | "createdAt">> {
  return messages.flatMap<Omit<StoredMessage, "id" | "createdAt">>((msg) => {
    if (msg.role === MessageRole.ASSISTANT) {
      const toolCalls: Array<{ input: Record<string, unknown>; name: string; toolUseId: string }> =
        [];
      let textContent = "";

      for (const c of msg.content) {
        if (c.type === BlockType.TOOL_USE) {
          toolCalls.push({
            input: c.input,
            name: c.name,
            toolUseId: c.toolUseId,
          });
        } else if (c.type === BlockType.TEXT) {
          textContent += c.text;
        }
      }

      return [
        {
          content: textContent || undefined,
          role: MessageRole.ASSISTANT,
          sessionId,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        },
      ];
    }

    // Explicit: stable system-role messages are not persisted. They are
    // reconstructed from agent.prompt at runtime. This drop is intentional, not silent.
    if (msg.role === MessageRole.SYSTEM) {
      return [];
    }

    if (
      (msg as TransientMemoryMessage).__obskuTransientMemoryInjection === true ||
      msg.content.some(
        (block) => block.type === BlockType.TEXT && block.text.includes(MEMORY_MARKER_START)
      )
    ) {
      return [];
    }

    if (msg.role !== MessageRole.USER) {
      return [];
    }

    const toolResults: Array<{
      content: string;
      fullOutputRef?: string;
      status?: "success" | "error";
      toolUseId: string;
    }> = [];
    let textContent = "";

    for (const c of msg.content) {
      if (c.type === BlockType.TOOL_RESULT) {
        toolResults.push({
          content: c.content,
          fullOutputRef: c.fullOutputRef,
          status: c.status,
          toolUseId: c.toolUseId,
        });
      } else if (c.type === BlockType.TEXT) {
        textContent += c.text;
      }
    }

    if (toolResults.length > 0) {
      return [
        {
          role: MessageRole.TOOL,
          sessionId,
          toolResults,
        },
      ];
    }

    if (!textContent) {
      return [];
    }

    return [
      {
        content: textContent,
        role: MessageRole.USER,
        sessionId,
      },
    ];
  });
}
