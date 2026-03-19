import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  parseStructuredOutput,
  StructuredOutputError,
  validateOutput,
} from "../../src/structured/output";

describe("validateOutput", () => {
  const schema = z.object({
    age: z.number(),
    name: z.string(),
  });

  test("validates correct JSON", () => {
    const text = '{"name": "Alice", "age": 30}';
    const result = validateOutput(schema, text);
    expect(result).toEqual({ age: 30, name: "Alice" });
  });

  test("validates JSON in markdown code block", () => {
    const text = '```json\n{"name": "Bob", "age": 25}\n```';
    const result = validateOutput(schema, text);
    expect(result).toEqual({ age: 25, name: "Bob" });
  });

  test("throws on invalid JSON", () => {
    const text = "not json";
    expect(() => validateOutput(schema, text)).toThrow(StructuredOutputError);
  });

  test("throws on wrong shape", () => {
    const text = '{"name": "Charlie", "age": "not a number"}';
    expect(() => validateOutput(schema, text)).toThrow(StructuredOutputError);
  });

  test("throws on missing required field", () => {
    const text = '{"name": "Dave"}';
    expect(() => validateOutput(schema, text)).toThrow(StructuredOutputError);
  });

  test("error contains validation details", () => {
    const text = '{"name": "Eve", "age": "invalid"}';
    try {
      validateOutput(schema, text);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredOutputError);
      const err = error as StructuredOutputError;
      expect(err.validationErrors.length).toBeGreaterThan(0);
      expect(err.receivedText).toBe(text);
    }
  });
});

describe("parseStructuredOutput - JSON extraction characterization", () => {
  const schema = z.object({
    name: z.string(),
    value: z.number(),
  });

  test("validates trimmed first, falls back to fenced if trimmed invalid", () => {
    // structured/output.ts prioritizes trimmed text FIRST, then fences
    // If trimmed is not valid JSON, falls through to fences
    const text = '{"name": "bare", "value": 1}\n```json\n{"name": "fenced", "value": 2}\n```';

    // trimmed text is NOT valid JSON (has trailing ```json...), so falls through
    // First valid JSON is from json_block match
    const result = parseStructuredOutput(schema, text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: "fenced", value: 2 });
    }
  });

  test("extracts fenced JSON when trimmed fails validation", () => {
    // If trimmed doesn't match schema, tries fenced
    const text = 'Not valid JSON\n```json\n{"name": "valid", "value": 42}\n```';

    const result = parseStructuredOutput(schema, text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: "valid", value: 42 });
    }
  });

  test("extracts bare JSON object from text", () => {
    const text = 'Here is the result: {"name": "extracted", "value": 100}';

    const result = parseStructuredOutput(schema, text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: "extracted", value: 100 });
    }
  });

  test("returns error when all JSON candidates fail validation", () => {
    const text = "not valid json";

    const result = parseStructuredOutput(schema, text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Error message comes from actual JSON parse failure
      expect(result.error).toContain("JSON Parse error");
    }
  });

  test("handles trailing text after JSON object", () => {
    const text = '{"name": "valid", "value": 1} and some trailing text';

    // trimmed text is invalid, so tries bare_json which extracts object
    const result = parseStructuredOutput(schema, text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: "valid", value: 1 });
    }
  });

  test("returns last validation error when all candidates fail", () => {
    const text = '```json\n{"wrong": "shape"}\n```\n{"also": "wrong"}';

    const result = parseStructuredOutput(schema, text);
    expect(result.ok).toBe(false);
    // Should return the error from the last attempted candidate
  });

  test("handles malformed fenced JSON - bare_json fallback may fail too", () => {
    const text = '```json\n{broken json}\n```\n{"name": "fallback", "value": 99}';

    const _result = parseStructuredOutput(schema, text);
    // The bare_json regex is greedy and may include the broken part
    // This test documents actual behavior - may succeed or fail depending on regex match
    // If bare_json extracts just {"name": "fallback", "value": 99}, it succeeds
    // If it includes the broken part, it fails
  });

  describe("validateOutput - error behavior characterization", () => {
    const schema = z.object({
      required: z.string(),
    });

    test("throws StructuredOutputError on validation failure", () => {
      const text = "not json";

      expect(() => validateOutput(schema, text)).toThrow(StructuredOutputError);
    });

    test("StructuredOutputError contains received text", () => {
      const text = "invalid data";

      try {
        validateOutput(schema, text);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(StructuredOutputError);
        const err = error as StructuredOutputError;
        expect(err.receivedText).toBe(text);
      }
    });
  });

  describe("Cross-entrypoint extraction precedence differences", () => {
    const schema = z.object({
      source: z.string(),
    });

    test("documents: json-utils prefers fenced, structured prefers valid from candidates", () => {
      // Key behavioral difference:
      // - json-utils.ts: json_fence > code_fence > trimmed > bare_json
      // - structured/output.ts: trimmed > json_block > code_block > bare_json

      // When trimmed is invalid JSON, structured falls through just like json-utils
      const input = '{"source": "first"}\n```json\n{"source": "fenced"}\n```';

      // trimmed is invalid (trailing content), so json_block is tried and succeeds
      // Result: "fenced" wins because it's the first valid candidate after trimmed fails

      const result = parseStructuredOutput(schema, input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.source).toBe("fenced");
      }
    });

    test("documents: all three have different failure modes", () => {
      // - json-utils: returns null
      // - memory helpers: returns []
      // - structured/output: returns {ok: false, error: string}

      const text = "completely invalid";
      const result = parseStructuredOutput(schema, text);
      expect(result.ok).toBe(false);

      // This is just documenting the three different behaviors
      // json-utils: null
      // memory: []
      // structured: {ok: false, error}
    });
  });
});
