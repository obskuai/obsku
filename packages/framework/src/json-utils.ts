import { LOG_PREVIEW_MAX_LENGTH } from "./constants";
import { formatError } from "./generic-utils";
import { telemetryLog } from "./telemetry/log";

export type JsonParseResult<T = unknown> =
  | { data: T; error: undefined; success: true }
  | { data: string; error: string; success: false };

/**
 * Source of extracted JSON candidate text
 */
export type JsonCandidateSource = "json_fence" | "code_fence" | "trimmed" | "bare_json";

/**
 * A JSON text candidate with its source
 */
export type JsonTextCandidate = {
  source: JsonCandidateSource;
  text: string;
};

/**
 * Failure record for a candidate that couldn't be parsed
 */
export type JsonCandidateFailure = {
  error: string;
  source: JsonCandidateSource;
};

/**
 * Result of parsing candidates - either success with data or failure with all attempts
 */
export type JsonCandidateParseResult<T = unknown> =
  | { data: T; success: true }
  | { failures: Array<JsonCandidateFailure>; success: false };

/**
 * Precedence options for JSON candidate extraction
 * - 'fenced_first': json_fence > code_fence > trimmed > bare_json (used by json-utils)
 * - 'trimmed_first': trimmed > json_fence > code_fence > bare_json (used by memory/output)
 */
export type ExtractionPrecedence = "fenced_first" | "trimmed_first";

/**
 * Extract JSON text candidates from input text in specified precedence order.
 * Returns candidates in order of preference, with duplicates removed.
 *
 * @param text - Input text that may contain JSON
 * @param precedence - Order to try candidates ('fenced_first' or 'trimmed_first')
 * @returns Array of candidates in precedence order
 */
export function getJsonTextCandidates(
  text: string,
  precedence: ExtractionPrecedence = "fenced_first"
): Array<JsonTextCandidate> {
  const trimmed = text.trim();
  const seen = new Set<string>();
  const candidates: Array<JsonTextCandidate> = [];

  function addCandidate(source: JsonCandidateSource, candidate: string | undefined): void {
    const normalized = candidate?.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push({ source, text: normalized });
  }

  // Always extract all candidates, but order depends on precedence
  if (precedence === "fenced_first") {
    // json-utils precedence: fenced blocks first, then trimmed, then bare
    addCandidate("json_fence", trimmed.match(/```json\s*\n?([\s\S]*?)\n?```/)?.[1]);
    addCandidate("code_fence", trimmed.match(/```\s*\n?([\s\S]*?)\n?```/)?.[1]);
    addCandidate("trimmed", trimmed);
    addCandidate("bare_json", trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)?.[1]);
  } else {
    // memory/output precedence: trimmed first, then fenced, then bare
    addCandidate("trimmed", trimmed);
    addCandidate("json_fence", trimmed.match(/```json\s*\n?([\s\S]*?)\n?```/)?.[1]);
    addCandidate("code_fence", trimmed.match(/```\s*\n?([\s\S]*?)\n?```/)?.[1]);
    addCandidate("bare_json", trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)?.[1]);
  }

  return candidates;
}

/**
 * Parse JSON candidates in order, returning first successful parse.
 *
 * @param candidates - Array of JSON text candidates
 * @returns Parse result with data or all failures
 */
export function parseJsonCandidates<T = unknown>(
  candidates: Array<JsonTextCandidate>
): JsonCandidateParseResult<T> {
  const failures: Array<JsonCandidateFailure> = [];

  for (const candidate of candidates) {
    const parsed = safeJsonParse<T>(candidate.text);
    if (parsed.success) {
      return { data: parsed.data, success: true };
    }
    failures.push({ error: parsed.error, source: candidate.source });
  }

  return { failures, success: false };
}

/**
 * Report JSON extraction failure via telemetry.
 *
 * @param text - Original input text (for preview)
 * @param failures - All candidate parse failures
 */
export function reportJsonExtractionFailure(
  text: string,
  failures: Array<JsonCandidateFailure>
): void {
  if (failures.length === 0) {
    return;
  }

  telemetryLog(
    `extractJsonFromText: failed to parse JSON candidates. Failures: ${failures.length}, preview: ${text.trim().slice(0, LOG_PREVIEW_MAX_LENGTH)}`
  );
}

/**
 * Extract JSON from text using fenced_first precedence.
 * Returns null if no valid JSON found.
 *
 * @param text - Input text containing JSON
 * @returns Parsed JSON or null
 */
export function extractJsonFromText(text: string): unknown | null {
  const result = parseJsonCandidates(getJsonTextCandidates(text, "fenced_first"));
  if (result.success) {
    return result.data;
  }

  reportJsonExtractionFailure(text, result.failures);
  return null;
}

/**
 * Safely parse JSON string with typed result.
 *
 * @param value - JSON string to parse
 * @returns Parse result with data or error message
 */
export function safeJsonParse<T = unknown>(value: string, validate?: (v: unknown) => T): JsonParseResult<T> {
  try {
    const parsed: unknown = JSON.parse(value);
    const data = validate ? validate(parsed) : (parsed as T);
    return { data, error: undefined, success: true };
  } catch (error: unknown) {
    return { data: value, error: formatError(error), success: false };
  }
}
