import type {
  ContentBlock as BedrockContentBlock,
  Message as BedrockMessage,
  Tool as BedrockTool,
  SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import {
  assertNever,
  BlockType,
  type ContentBlock,
  type LLMResponse,
  type Message,
  normalizeStopReason,
  type ToolDef,
} from "@obsku/framework";

export function toBedrockMessages(messages: Array<Message>): Array<BedrockMessage> {
  return messages
    .filter((msg): msg is Message & { role: "user" | "assistant" } => msg.role !== "system")
    .map((msg) => ({
      content: msg.content
        // Filter out empty text blocks — Bedrock rejects blank text fields
        .filter(
          (block: ContentBlock) => !(block.type === BlockType.TEXT && block.text.trim() === "")
        )
        .map((block: ContentBlock) => {
          switch (block.type) {
            case BlockType.TEXT:
              return { text: block.text } as BedrockContentBlock;
            case BlockType.TOOL_USE:
              return {
                toolUse: {
                  input: block.input,
                  name: block.name,
                  toolUseId: block.toolUseId,
                },
              } as BedrockContentBlock;
            case BlockType.TOOL_RESULT: {
              const toolResult: {
                content: [{ text: string }];
                status?: "error";
                toolUseId: string;
              } = {
                content: [{ text: block.content }],
                toolUseId: block.toolUseId,
              };
              if (block.status === "error") {
                toolResult.status = "error";
              }
              return { toolResult } as BedrockContentBlock;
            }
            default:
              return assertNever(block);
          }
        }),
      role: msg.role,
    }));
}

export function toBedrockTools(tools: Array<ToolDef>): Array<BedrockTool> {
  return tools.map(
    (t) =>
      ({
        toolSpec: {
          description: t.description,
          inputSchema: { json: t.inputSchema },
          name: t.name,
        },
      }) as BedrockTool
  );
}

/**
 * Convert system-role content blocks to Bedrock SystemContentBlock array.
 * Handles text blocks and cache_point blocks.
 * Returns undefined if all text blocks are empty (Bedrock rejects blank system fields).
 */
export function toBedrockSystemBlocks(
  content: Array<{ type: string; text?: string }>
): Array<SystemContentBlock> | undefined {
  const blocks: Array<SystemContentBlock> = [];

  for (const block of content) {
    if (block.type === "cache_point") {
      blocks.push({ cachePoint: { type: "default" } });
    } else if (block.type === BlockType.TEXT) {
      const text = block.text ?? "";
      if (text.trim() !== "") {
        blocks.push({ text });
      }
    }
  }

  return blocks.length > 0 ? blocks : undefined;
}

export function fromBedrockContent(blocks: Array<BedrockContentBlock>): Array<ContentBlock> {
  return blocks.map((block): ContentBlock => {
    if (block.text !== undefined) {
      return { text: block.text, type: BlockType.TEXT };
    }
    if (block.toolUse) {
      return {
        input: (typeof block.toolUse.input === "object" && block.toolUse.input !== null
          ? block.toolUse.input
          : {}) as Record<string, unknown>,
        name: block.toolUse.name ?? "",
        toolUseId: block.toolUse.toolUseId ?? "",
        type: BlockType.TOOL_USE,
      };
    }
    return { text: "", type: BlockType.TEXT };
  });
}

export function mapStopReason(reason: string | undefined): LLMResponse["stopReason"] {
  return normalizeStopReason(reason);
}
