import { DEFAULTS } from "../defaults";
import type { Message } from "../types";
import { BlockType, MessageRole } from "../types/constants";
import type { Entity, Fact } from "./types";

/**
 * Build a human-readable context string from entities and facts.
 * Truncates intelligently if over maxLength.
 */
export function buildContextString(
  entities: Array<Entity>,
  facts: Array<Fact>,
  maxLength: number
): string {
  if (entities.length === 0 && facts.length === 0) {
    return "";
  }

  const sections: Array<string> = [];

  if (entities.length > 0) {
    const entityLines = entities.map((entity) => {
      const attrs = Object.entries(entity.attributes)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(", ");
      return `- ${entity.name} (${entity.type})${attrs ? `: ${attrs}` : ""}`;
    });
    sections.push(`Known Entities:\n${entityLines.join("\n")}`);
  }

  if (facts.length > 0) {
    const factLines = facts.map((fact) => `- ${fact.content}`);
    sections.push(`Relevant Facts:\n${factLines.join("\n")}`);
  }

  let result = sections.join("\n\n");

  if (result.length > maxLength) {
    result = truncateIntelligently(result, maxLength);
  }

  return result;
}

function truncateIntelligently(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const truncated = text.slice(0, maxLength - 3);
  const lastNewline = truncated.lastIndexOf("\n");

  if (lastNewline > maxLength * DEFAULTS.contextWindow.pruneThreshold) {
    return truncated.slice(0, lastNewline) + "...";
  }

  return truncated + "...";
}

/**
 * Format messages into a summary-friendly string for LLM processing.
 */
export function formatMessagesForSummary(messages: Array<Message>): string {
  return messages
    .map((msg) => {
      const role = msg.role === MessageRole.USER ? "User" : "Assistant";
      const text = msg.content
        .filter(
          (b): b is { text: string; type: typeof BlockType.TEXT } => b.type === BlockType.TEXT
        )
        .map((b) => b.text)
        .join("");
      return `${role}: ${text}`;
    })
    .join("\n\n");
}
