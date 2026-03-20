import type { z } from "zod";
import { getJsonTextCandidates, safeJsonParse } from "../json-utils";
import type { ParseResult } from "../parse-contract";

/**
 * Error thrown when LLM output fails Zod validation.
 * Public error pattern: extends Error + readonly _tag.
 */
export class StructuredOutputError extends Error {
  readonly _tag = "StructuredOutputError" as const;
  constructor(
    readonly validationErrors: Array<string>,
    readonly receivedText: string
  ) {
    super(`Structured output validation failed: ${validationErrors.join(", ")}`);
    this.name = "StructuredOutputError";
  }
}

export function parseStructuredOutput<T>(schema: z.ZodType<T>, text: string): ParseResult<T> {
  // Use trimmed_first precedence to match original behavior
  const candidates = getJsonTextCandidates(text, "trimmed_first");
  if (candidates.length === 0) {
    return {
      error: "Invalid JSON: could not extract valid JSON from text",
      ok: false,
      raw: text,
    };
  }

  let lastFailure: ParseResult<T> = {
    error: "Invalid JSON: could not extract valid JSON from text",
    ok: false,
    raw: text,
  };

  for (const candidate of candidates) {
    // Parse JSON first, then validate against schema
    const parsed = safeJsonParse<unknown>(candidate.text);
    if (!parsed.success) {
      lastFailure = {
        error: parsed.error,
        ok: false,
        raw: candidate.text,
      };
      continue;
    }

    // Now validate the parsed data against the schema
    const result = schema.safeParse(parsed.data);
    if (result.success) {
      return {
        ok: true,
        value: result.data,
      };
    }

    // Validation failed - format the error
    const error = result.error.issues
      .map((issue) => {
        const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
        return `${path}: ${issue.message}`;
      })
      .join("; ");

    lastFailure = {
      error,
      ok: false,
      raw: candidate.text,
    };
  }

  return lastFailure;
}

/**
 * Parse and validate LLM text output against Zod schema.
 *
 * @param schema - Zod schema to validate against
 * @param text - LLM response text (should contain JSON)
 * @returns Parsed and validated object
 * @throws StructuredOutputError if validation fails
 */
export function validateOutput<T>(schema: z.ZodType<T>, text: string): T {
  const parsed = parseStructuredOutput(schema, text);
  if (!parsed.ok) {
    throw new StructuredOutputError([parsed.error], text);
  }

  return parsed.value;
}
