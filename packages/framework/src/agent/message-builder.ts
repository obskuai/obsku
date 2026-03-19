import type { TaskManager } from "../background";
import type { BlobStore } from "../blob/types";
import { DEFAULTS } from "../defaults";
import { getErrorMessage } from "../error-utils";
import { debugLog } from "../telemetry";
import type { Logger, Message, PluginTruncationConfig, TextContent } from "../types";
import { BlockType, MessageRole } from "../types/constants";
import type { ResolvedTruncation } from "./truncation-resolve";

export function buildInitialMessages(
  systemPrompt: string,
  userInput: string,
  history: Array<Message> = []
): Array<Message> {
  const systemContent: TextContent = { text: systemPrompt, type: BlockType.TEXT };
  const userContent: TextContent = { text: userInput, type: BlockType.TEXT };

  return [
    { content: [systemContent], role: MessageRole.SYSTEM },
    ...history,
    { content: [userContent], role: MessageRole.USER },
  ];
}

export function buildBackgroundNotifications(
  taskManager: TaskManager,
  lastCheck: number
): { messages: Array<Message>; newCheckTime: number } {
  const completedTasks = taskManager.getCompletedSince(lastCheck);
  if (completedTasks.length === 0) {
    return { messages: [], newCheckTime: lastCheck };
  }

  return {
    messages: [
      {
        content: [
          {
            text: `[System] Background tasks completed: ${completedTasks
              .map((t) => `${t.id} (use get_result to retrieve)`)
              .join(", ")}`,
            type: BlockType.TEXT,
          },
        ],
        role: MessageRole.USER,
      },
    ],
    newCheckTime: Date.now(),
  };
}

let truncationCounter = 0;

export function computeTruncationThreshold(contextWindowSize: number): number {
  return Math.floor((contextWindowSize * DEFAULTS.preview.truncationRatio) / 4);
}

export interface TruncatedToolResult {
  content: string;
  fullOutputRef?: string;
}

export async function truncateToolResult(
  result: string,
  threshold: number,
  blobStore?: BlobStore,
  logger?: Logger
): Promise<TruncatedToolResult> {
  if (threshold <= 0 || result.length <= threshold) {
    return { content: result };
  }

  const truncated = result.slice(0, threshold);
  let ref: string | undefined;

  if (blobStore) {
    const key = `tool-output-${truncationCounter++}`;
    try {
      ref = await blobStore.put(key, result);
    } catch (error: unknown) {
      const msg = `[Agent] BlobStore.put() failed (${getErrorMessage(error)}), truncating without ref`;
      if (logger) {
        logger.error(msg);
      } else {
        debugLog(msg);
      }
    }
  }

  if (ref) {
    return {
      content: `${truncated}\n\n[Output truncated at ${threshold} chars. Full output available via read_tool_output tool, ref: ${ref}]`,
      fullOutputRef: ref,
    };
  }
  return {
    content: `${truncated}\n\n[Output truncated at ${threshold} chars.]`,
  };
}

export function buildToolResultMessages(
  results: Array<{ isError: boolean; result: string; toolUseId: string }>
): Array<Message> {
  if (results.length === 0) {
    return [];
  }
  return [
    {
      content: results.map((tr) => ({
        content: tr.result,
        status: tr.isError ? ("error" as const) : ("success" as const),
        toolUseId: tr.toolUseId,
        type: BlockType.TOOL_RESULT,
      })),
      role: MessageRole.USER,
    },
  ];
}

export async function buildToolResultMessagesWithTruncation(
  results: Array<{ isError: boolean; result: string; toolName?: string; toolUseId: string }>,
  resolvedTruncation: Extract<ResolvedTruncation, { active: true }>,
  pluginTruncation?: Map<string, PluginTruncationConfig>,
  logger?: Logger
): Promise<Array<Message>> {
  const { blobStore, threshold } = resolvedTruncation.config;

  const contentBlocks = [];
  for (const tr of results) {
    const pluginConfig = tr.toolName ? pluginTruncation?.get(tr.toolName) : undefined;

    if (pluginConfig?.enabled === false) {
      contentBlocks.push({
        content: tr.result,
        status: tr.isError ? ("error" as const) : ("success" as const),
        toolUseId: tr.toolUseId,
        type: "tool_result" as const,
      });
      continue;
    }

    const effectiveThreshold = pluginConfig?.threshold ?? threshold;
    const effectiveBlobStore = pluginConfig?.saveToStore === false ? undefined : blobStore;

    const truncated = await truncateToolResult(
      tr.result,
      effectiveThreshold,
      effectiveBlobStore,
      logger
    );
    contentBlocks.push({
      content: truncated.content,
      fullOutputRef: truncated.fullOutputRef,
      status: tr.isError ? ("error" as const) : ("success" as const),
      toolUseId: tr.toolUseId,
      type: "tool_result" as const,
    });
  }
  if (contentBlocks.length === 0) {
    return [];
  }
  return [{ content: contentBlocks, role: "user" as const }];
}
