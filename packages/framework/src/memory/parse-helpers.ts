import { z } from "zod";
import { getJsonTextCandidates, safeJsonParse } from "../json-utils";
import { EntitySchema, validate } from "../checkpoint/schemas";
import { DEFAULTS } from "../defaults";
import type { LLMResponse, Logger } from "../types";
import { BlockType } from "../types/constants";
import { generateId } from "../utils";
import type { Entity, Fact } from "./types";

/**
 * Extract text content from LLM response. Returns first text block or null.
 */
export function extractTextFromResponse(response: LLMResponse): string | null {
  for (const block of response.content) {
    if (block.type === BlockType.TEXT) {
      return block.text;
    }
  }
  return null;
}

interface RawEntity {
  attributes?: unknown;
  name?: unknown;
  relationships?: unknown;
  type?: unknown;
}

const JsonArraySchema = z.array(z.unknown());

function parseJsonArrayFromText(
  text: string,
  label: "entities" | "facts",
  logger?: Logger
): Array<unknown> {
  // Use trimmed_first precedence to match original behavior
  const candidates = getJsonTextCandidates(text, "trimmed_first");
  if (candidates.length === 0) {
    logger?.warn(`[Memory] Failed to parse ${label}: no JSON candidate found`);
    return [];
  }

  // Try each candidate until one parses and validates as an array
  for (const candidate of candidates) {
    const parsed = safeJsonParse<unknown>(candidate.text);
    if (!parsed.success) {
      continue;
    }

    // Validate that the parsed result is an array
    const result = JsonArraySchema.safeParse(parsed.data);
    if (result.success) {
      return result.data;
    }
  }

  // All candidates failed
  logger?.warn(`[Memory] Failed to parse ${label}: no valid JSON array found`);
  return [];
}

/**
 * Parse entities from LLM extraction response. Handles malformed JSON gracefully.
 */
export function parseEntitiesFromResponse(
  result: LLMResponse,
  sessionId: string,
  workspaceId?: string,
  logger?: Logger
): Array<Entity> {
  const text = extractTextFromResponse(result);
  if (!text) {
    return [];
  }

  const parsed = parseJsonArrayFromText(text, "entities", logger);

  return parsed.flatMap((raw) => {
    if (!isValidRawEntity(raw)) {return [];}
    return [
      {
        attributes: parseAttributes(raw.attributes, logger),
        createdAt: Date.now(),
        id: generateId(),
        name: String(raw.name),
        relationships: parseRelationships(raw.relationships, logger),
        sessionId,
        type: String(raw.type),
        updatedAt: Date.now(),
        workspaceId,
      },
    ];
  });
}

function isValidRawEntity(item: unknown): item is RawEntity {
  if (typeof item !== "object" || item === null) {
    return false;
  }
  const obj = item as Record<string, unknown>;
  return typeof obj.name === "string" && typeof obj.type === "string";
}

function parseAttributes(attrs: unknown, logger?: Logger): Record<string, unknown> {
  const AttributesSchema = EntitySchema.shape.attributes;
  const validated = validate(AttributesSchema, attrs);
  if (validated === null) {
    logger?.warn("[Memory] Invalid attributes format, using empty object");
    return {};
  }
  return Object.fromEntries(Object.entries(validated).filter(([, v]) => v !== undefined));
}

const RawRelationshipSchema = z.object({
  targetName: z.string(),
  type: z.string(),
});

function parseRelationships(
  rels: unknown,
  logger?: Logger
): Array<{ targetId: string; type: string }> {
  if (!Array.isArray(rels)) {
    logger?.warn("[Memory] Invalid relationships format (not array), using empty array");
    return [];
  }

  const validated = rels.flatMap((r) => {
    const validated = validate(RawRelationshipSchema, r);
    return validated !== null ? [validated] : [];
  });

  if (validated.length === 0 && rels.length > 0) {
    logger?.warn("[Memory] Invalid relationships format, using empty array");
  }

  return validated.map((r) => ({
    targetId: r.targetName,
    type: r.type,
  }));
}

interface RawFact {
  confidence?: unknown;
  content?: unknown;
}

/**
 * Parse facts from LLM extraction response. Handles malformed JSON gracefully.
 */
export function parseFactsFromResponse(
  result: LLMResponse,
  workspaceId?: string,
  sessionId?: string,
  logger?: Logger
): Array<Fact> {
  const text = extractTextFromResponse(result);
  if (!text) {
    return [];
  }

  const parsed = parseJsonArrayFromText(text, "facts", logger);

  return parsed.flatMap((raw) => {
    if (!isValidRawFact(raw)) {return [];}
    return [
      {
        confidence: normalizeConfidence(raw.confidence),
        content: String(raw.content),
        createdAt: Date.now(),
        id: generateId(),
        sourceSessionId: sessionId,
        workspaceId,
      },
    ];
  });
}

function isValidRawFact(item: unknown): item is RawFact {
  if (typeof item !== "object" || item === null) {
    return false;
  }
  const obj = item as Record<string, unknown>;
  return typeof obj.content === "string";
}

function normalizeConfidence(conf: unknown): number {
  if (typeof conf === "number" && conf >= 0 && conf <= 1) {
    return conf;
  }
  return DEFAULTS.memory.defaultFactConfidence;
}
