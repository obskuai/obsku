import type { LLMProvider } from "../../types";
import { CONVERSATION_SUMMARY_PROMPT, FACT_EXTRACTION_PROMPT } from "../prompts";
import type { MemoryHookContext } from "../types";
import {
  extractTextFromResponse,
  formatMessagesForSummary,
  parseFactsFromResponse,
} from "../utils";

/**
 * Default memory save hook. Summarizes conversation and extracts facts.
 * Generates embeddings if embeddingProvider is configured.
 */
export async function defaultOnMemorySave(
  ctx: MemoryHookContext,
  provider: LLMProvider
): Promise<void> {
  if (ctx.messages.length === 0) {
    return;
  }

  const conversationText = formatMessagesForSummary(ctx.messages);

  const summaryResult = await provider.chat([
    {
      content: [
        {
          text: `${CONVERSATION_SUMMARY_PROMPT}${conversationText}`,
          type: "text",
        },
      ],
      role: "user",
    },
  ]);

  const summary = extractTextFromResponse(summaryResult);
  if (!summary) {
    return;
  }

  const factResult = await provider.chat([
    {
      content: [
        {
          text: `${FACT_EXTRACTION_PROMPT}${summary}`,
          type: "text",
        },
      ],
      role: "user",
    },
  ]);

  const facts = parseFactsFromResponse(factResult, ctx.workspaceId, ctx.sessionId);
  await Promise.all(
    facts.map(async (fact) => {
      let embedding: number[] | undefined;

      if (ctx.embeddingProvider) {
        embedding = await ctx.embeddingProvider.embed(fact.content);
      }

      await ctx.store.saveFact({
        confidence: fact.confidence,
        content: fact.content,
        embedding,
        sourceSessionId: fact.sourceSessionId,
        workspaceId: fact.workspaceId,
      });
    })
  );
}
