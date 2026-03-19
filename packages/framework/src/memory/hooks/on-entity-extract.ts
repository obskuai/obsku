import type { LLMProvider, LLMResponse } from "../../types";
import { ENTITY_EXTRACTION_PROMPT } from "../prompts";
import type { Entity, MemoryHookContext } from "../types";
import { extractTextFromResponse, parseEntitiesFromResponse } from "../utils";

type ExtractContext = MemoryHookContext & { response: LLMResponse };

/**
 * Default entity extraction hook. Uses LLM to extract entities from response.
 * Generates embeddings if embeddingProvider is configured.
 */
export async function defaultOnEntityExtract(
  ctx: ExtractContext,
  provider: LLMProvider
): Promise<Array<Entity>> {
  const responseText = extractTextFromResponse(ctx.response);
  if (!responseText) {
    return [];
  }

  const extractionResult = await provider.chat([
    {
      content: [
        {
          text: `${ENTITY_EXTRACTION_PROMPT}${responseText}`,
          type: "text",
        },
      ],
      role: "user",
    },
  ]);

  const entities = parseEntitiesFromResponse(extractionResult, ctx.sessionId, ctx.workspaceId);
  await Promise.all(
    entities.map(async (entity) => {
      let embedding: number[] | undefined;

      if (ctx.embeddingProvider) {
        const textToEmbed = `${entity.name} ${entity.type} ${JSON.stringify(entity.attributes)}`;
        embedding = await ctx.embeddingProvider.embed(textToEmbed);
      }

      await ctx.store.saveEntity({
        attributes: entity.attributes,
        embedding,
        name: entity.name,
        relationships: entity.relationships,
        sessionId: entity.sessionId,
        type: entity.type,
        workspaceId: entity.workspaceId,
      });
    })
  );

  return entities;
}
