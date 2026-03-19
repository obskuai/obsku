// =============================================================================
// @obsku/framework — Default compaction strategy (LLM-based summarization)
// =============================================================================

import type { CompactionStrategy } from "../types/compaction";
import { DEFAULTS } from "../defaults";
import { BlockType, MessageRole } from "../types/constants";
import type { Message, TextContent } from "../types/llm";
import type { LLMProvider } from "../types/providers";

const COMPACTION_PROMPT_PREFIX = `You are a conversation summarizer. Your task is to create a concise summary of the following conversation, preserving key information and context.

<conversation>
`;

const COMPACTION_PROMPT_SUFFIX = `
</conversation>

Create a summary that:
1. Captures main topics and decisions
2. Preserves important facts and findings
3. Keeps tool outputs that are still relevant
4. Is 30-50% of original length

Return ONLY the summary text, no additional commentary.
`;

function buildConversationText(messages: Array<Message>): string {
  return messages
    .map((msg) => {
      const role = msg.role === MessageRole.USER ? "User" : "Assistant";
      const text = msg.content
        .filter((b): b is TextContent => b.type === BlockType.TEXT)
        .map((b) => b.text)
        .join("");
      return `${role}: ${text}`;
    })
    .join("\n\n");
}

export class DefaultCompactionStrategy implements CompactionStrategy {
  async compact(messages: Array<Message>, provider: LLMProvider): Promise<Array<Message>> {
    if (messages.length <= DEFAULTS.compaction.recentMessagesBuffer + 1) {
      return messages;
    }

    const systemMessage = messages[0];
    const recentMessages = messages.slice(-DEFAULTS.compaction.recentMessagesBuffer);
    const middleMessages = messages.slice(1, -DEFAULTS.compaction.recentMessagesBuffer);

    const conversationText = buildConversationText(middleMessages);
    const compactionPrompt = `${COMPACTION_PROMPT_PREFIX}${conversationText}${COMPACTION_PROMPT_SUFFIX}`;

    const response = await provider.chat(
      [
        {
          content: [{ text: compactionPrompt, type: BlockType.TEXT }],
          role: MessageRole.USER,
        },
      ],
      undefined
    );

    const summaryText = response.content
      .filter((c): c is TextContent => c.type === BlockType.TEXT)
      .map((c) => c.text)
      .join("");

    const summaryMessage: Message = {
      content: [
        {
          text: `## Conversation Summary\n\n${summaryText}`,
          type: BlockType.TEXT,
        },
      ],
      role: MessageRole.USER,
    };

    return [systemMessage, summaryMessage, ...recentMessages];
  }
}

export class SlidingWindowCompactionStrategy implements CompactionStrategy {
  constructor(private config: { preserveSystemMessage?: boolean; windowSize: number }) {}

  async compact(messages: Array<Message>, _provider: LLMProvider): Promise<Array<Message>> {
    const { preserveSystemMessage = true, windowSize } = this.config;

    if (messages.length === 0) {
      return [];
    }

    const hasSystem = preserveSystemMessage && messages.length > 0;
    const maxMessages = hasSystem ? windowSize + 1 : windowSize;

    if (messages.length <= maxMessages) {
      return [...messages];
    }

    const result: Array<Message> = hasSystem ? [messages[0]] : [];
    const startIndex = Math.max(hasSystem ? 1 : 0, messages.length - windowSize);
    const candidateMessages = messages.slice(startIndex);

    const brokenToolIds = this.findBrokenToolIds(candidateMessages);

    for (const msg of candidateMessages) {
      if (!this.hasBrokenTool(msg, brokenToolIds)) {
        result.push(msg);
      }
    }

    return result;
  }

  private findBrokenToolIds(messages: Array<Message>): Set<string> {
    const toolUseIds = new Set<string>();
    const toolResultIds = new Set<string>();

    for (const msg of messages) {
      for (const block of msg.content) {
        if (block.type === BlockType.TOOL_USE) {
          toolUseIds.add(block.toolUseId);
        } else if (block.type === BlockType.TOOL_RESULT) {
          toolResultIds.add(block.toolUseId);
        }
      }
    }

    const broken = new Set<string>();
    for (const id of toolUseIds) {
      if (!toolResultIds.has(id)) {broken.add(id);}
    }
    for (const id of toolResultIds) {
      if (!toolUseIds.has(id)) {broken.add(id);}
    }
    return broken;
  }

  private hasBrokenTool(msg: Message, brokenToolIds: Set<string>): boolean {
    return msg.content.some(
      (block) =>
        (block.type === BlockType.TOOL_USE || block.type === BlockType.TOOL_RESULT) &&
        brokenToolIds.has(block.toolUseId)
    );
  }
}
