import type { SystemContentBlock } from "@aws-sdk/client-bedrock-runtime";
import {
  type Message,
  MessageRole,
  type ResponseFormat,
  type ToolDef,
  DEFAULTS,
} from "@obsku/framework";
import { toBedrockMessages, toBedrockSystemBlocks, toBedrockTools } from "./converters";

/**
 * Separate system-role messages from conversational messages.
 * Concatenates all system-role content into a single Bedrock system array.
 * Non-system messages pass through unchanged.
 */
function extractSystemMessages(messages: Array<Message>): {
  nonSystemMessages: Array<Message>;
  systemBlocks: Array<SystemContentBlock> | undefined;
} {
  const nonSystemMessages: Array<Message> = [];
  const allSystemContent: Array<{ type: string; text?: string }> = [];

  for (const msg of messages) {
    if ((msg.role as string) === MessageRole.SYSTEM) {
      for (const block of msg.content) {
        allSystemContent.push(block as { type: string; text?: string });
      }
    } else {
      nonSystemMessages.push(msg);
    }
  }

  return {
    nonSystemMessages,
    systemBlocks: allSystemContent.length > 0 ? toBedrockSystemBlocks(allSystemContent) : undefined,
  };
}

function buildOutputConfig(responseFormat: ResponseFormat | undefined):
  | {
      textFormat: {
        structure: {
          jsonSchema: {
            description?: string;
            name?: string;
            schema: string;
          };
        };
        type: "json_schema";
      };
    }
  | undefined {
  if (!responseFormat) {
    return undefined;
  }

  return {
    textFormat: {
      structure: {
        jsonSchema: {
          schema: JSON.stringify(responseFormat.jsonSchema.schema),
          ...(responseFormat.jsonSchema.name ? { name: responseFormat.jsonSchema.name } : {}),
          ...(responseFormat.jsonSchema.description
            ? { description: responseFormat.jsonSchema.description }
            : {}),
        },
      },
      type: "json_schema" as const,
    },
  };
}

export function buildCommandConfig(
  modelId: string,
  maxTokens: number,
  messages: Array<Message>,
  tools?: Array<ToolDef>,
  thinkingBudgetTokens?: number,
  responseFormat?: ResponseFormat
) {
  const isThinkingEnabled = thinkingBudgetTokens !== undefined && thinkingBudgetTokens > 0;
  const thinking = isThinkingEnabled
    ? { budgetTokens: thinkingBudgetTokens ?? DEFAULTS.thinkingBudgetTokens }
    : undefined;

  const { nonSystemMessages, systemBlocks } = extractSystemMessages(messages);
  const outputConfig = buildOutputConfig(responseFormat);

  return {
    messages: toBedrockMessages(nonSystemMessages),
    modelId,
    ...(systemBlocks && systemBlocks.length > 0 ? { system: systemBlocks } : {}),
    ...(tools && tools.length > 0 ? { toolConfig: { tools: toBedrockTools(tools) } } : {}),
    inferenceConfig: { maxTokens },
    ...(thinking ? { thinking } : {}),
    ...(outputConfig ? { outputConfig } : {}),
  };
}
