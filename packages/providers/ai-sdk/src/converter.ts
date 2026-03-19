/**
 * Bidirectional converters between obsku framework types and AI SDK types.
 */

import {
  assertNever,
  BlockType,
  type ContentBlock,
  type JsonSchema,
  type LLMResponse,
  type Message,
  type ToolDef,
} from "@obsku/framework";
import { mapAiSdkStopReason } from "./stop-reason";
import type {
  CoreMessage,
  GenerateTextResult,
  LanguageModelUsage,
  ToolCallPart,
  ToolSet,
} from "ai";

// --- obsku → AI SDK ---

/**
 * Convert obsku Message[] to AI SDK format.
 * Extracts system messages into a separate `system` string, remaining messages to CoreMessage[].
 */
export function toAiSdkMessages(messages: Array<Message>): {
  system?: string;
  messages: Array<CoreMessage>;
} {
  const systemParts: Array<string> = [];
  const coreMessages: Array<CoreMessage> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // Extract text from system message content blocks
      const text = msg.content
        .filter(
          (block): block is { type: "text"; text: string } =>
            block.type === BlockType.TEXT && block.text.trim() !== ""
        )
        .map((b) => b.text)
        .join("\n");
      if (text) {
        systemParts.push(text);
      }
      continue;
    }

    // Convert non-system messages
    const filteredContent = msg.content.filter(
      (block: ContentBlock) => !(block.type === BlockType.TEXT && block.text.trim() === "")
    );

    if (filteredContent.length === 0) continue;

    // Check for tool_use blocks - need special handling
    const toolUseBlocks = filteredContent.filter(
      (
        b
      ): b is {
        type: "tool_use";
        name: string;
        toolUseId: string;
        input: Record<string, unknown>;
      } => b.type === BlockType.TOOL_USE
    );
    const toolResultBlocks = filteredContent.filter(
      (
        b
      ): b is {
        type: "tool_result";
        toolUseId: string;
        content: string;
        status?: "success" | "error";
      } => b.type === BlockType.TOOL_RESULT
    );
    const textBlocks = filteredContent.filter(
      (b): b is { type: "text"; text: string } => b.type === BlockType.TEXT
    );

    if (toolResultBlocks.length > 0) {
      // Tool result message
      coreMessages.push({
        role: "tool",
        content: toolResultBlocks.map((b) => ({
          type: "tool-result" as const,
          toolCallId: b.toolUseId,
          toolName: "", // AI SDK requires this but it's not critical for results
          result: b.content,
          isError: b.status === "error",
        })),
      });
    } else if (toolUseBlocks.length > 0) {
      // Assistant message with tool calls
      const assistantContent: Array<{ type: "text"; text: string } | ToolCallPart> = [
        ...textBlocks.map((b) => ({ type: "text" as const, text: b.text })),
        ...toolUseBlocks.map((b) => ({
          type: "tool-call" as const,
          toolCallId: b.toolUseId,
          toolName: b.name,
          args: b.input,
        })),
      ];
      coreMessages.push({
        role: "assistant",
        content: assistantContent.length > 0 ? assistantContent : "",
      });
    } else if (textBlocks.length > 0) {
      // Pure text message
      const text = textBlocks.map((b) => b.text).join("\n");
      coreMessages.push({
        role: msg.role,
        content: text,
      });
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: coreMessages,
  };
}

/**
 * Convert obsku ToolDef[] to AI SDK Record<string, CoreTool> format.
 */
export function toAiSdkTools(
  tools: Array<ToolDef>
): Record<string, { description?: string; parameters: JsonSchema }> {
  const result: Record<string, { description?: string; parameters: JsonSchema }> = {};

  for (const tool of tools) {
    result[tool.name] = {
      description: tool.description,
      parameters: tool.inputSchema,
    };
  }

  return result;
}

// --- AI SDK → obsku ---

/**
 * Convert AI SDK GenerateTextResult to obsku LLMResponse.
 */
export function fromAiSdkResponse(result: GenerateTextResult<ToolSet, unknown>): LLMResponse {
  const content: Array<ContentBlock> = [];

  // Add text content
  if (result.text) {
    content.push({ type: BlockType.TEXT, text: result.text });
  }

  // Add tool calls
  for (const toolCall of result.toolCalls) {
    content.push({
      type: BlockType.TOOL_USE,
      toolUseId: toolCall.toolCallId,
      name: toolCall.toolName,
      input: (toolCall.args as Record<string, unknown>) ?? {},
    });
  }

  // Map usage - AI SDK uses promptTokens/completionTokens
  const usage = result.usage as LanguageModelUsage | undefined;
  const inputTokens = usage?.promptTokens ?? 0;
  const outputTokens = usage?.completionTokens ?? 0;

  return {
    content,
    stopReason: mapAiSdkStopReason(result.finishReason),
    usage: { inputTokens, outputTokens },
  };
}
