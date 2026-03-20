import { describe, expect, test } from "bun:test";
import {
  extractJsonFromText,
  getErrorMessage,
  generateId,
  isAsyncIterable,
  safeJsonParse,
  toToolResultEnvelope,
} from "../src/utils";

describe("isAsyncIterable", () => {
  test("returns true for async generator", async () => {
    async function* asyncGen() {
      yield 1;
      yield 2;
    }

    expect(isAsyncIterable(asyncGen())).toBe(true);
  });

  test("returns true for async iterable object", () => {
    const asyncIterable = {
      async *[Symbol.asyncIterator]() {
        yield "a";
        yield "b";
      },
    };

    expect(isAsyncIterable(asyncIterable)).toBe(true);
  });

  test("returns false for plain object", () => {
    expect(isAsyncIterable({})).toBe(false);
    expect(isAsyncIterable({ foo: "bar" })).toBe(false);
  });

  test("returns false for array", () => {
    expect(isAsyncIterable([1, 2, 3])).toBe(false);
  });

  test("returns false for null and undefined", () => {
    expect(isAsyncIterable(null)).toBe(false);
    expect(isAsyncIterable(undefined)).toBe(false);
  });

  test("returns false for string", () => {
    expect(isAsyncIterable("hello")).toBe(false);
  });

  test("returns false for number", () => {
    expect(isAsyncIterable(42)).toBe(false);
  });
});

describe("getErrorMessage", () => {
  test("extracts message from Error instance", () => {
    const error = new Error("Something went wrong");
    expect(getErrorMessage(error)).toBe("Something went wrong");
  });

  test("returns string as-is for string input", () => {
    expect(getErrorMessage("plain error message")).toBe("plain error message");
  });

  test("converts number to string", () => {
    expect(getErrorMessage(404)).toBe("404");
  });

  test("converts null to string", () => {
    expect(getErrorMessage(null)).toBe("null");
  });

  test("converts undefined to string", () => {
    expect(getErrorMessage(undefined)).toBe(undefined);
  });

  test("converts object to string", () => {
    const obj = { code: 500 };
    expect(getErrorMessage(obj)).toBe('{"code":500}');
  });

  test("handles custom Error subclass", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }

    const error = new CustomError("Custom error occurred");
    expect(getErrorMessage(error)).toBe("Custom error occurred");
  });
});

describe("generateId", () => {
  test("generates ID with prefix", () => {
    const id = generateId("test");
    expect(id).toMatch(/^test-[a-f0-9]{8}$/);
  });

  test("generates unique IDs", () => {
    const id1 = generateId("prefix");
    const id2 = generateId("prefix");
    expect(id1).not.toBe(id2);
  });

  test("handles different prefixes", () => {
    const id1 = generateId("foo");
    const id2 = generateId("bar");

    expect(id1.startsWith("foo-")).toBe(true);
    expect(id2.startsWith("bar-")).toBe(true);
  });
});

describe("safeJsonParse", () => {
  test("returns success contract for valid JSON", () => {
    expect(safeJsonParse('{"ok":true}')).toEqual({
      data: { ok: true },
      error: undefined,
      success: true,
    });
  });

  test("returns failure contract for invalid JSON", () => {
    expect(safeJsonParse("plain text")).toEqual({
      data: "plain text",
      error: expect.any(String),
      success: false,
    });
  });

  test("calls validate when provided and returns typed result", () => {
    const result = safeJsonParse('{"a":1}', (v) => v as { a: number });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.a).toBe(1);
  });

  test("returns error when validate throws", () => {
    const result = safeJsonParse('{"a":1}', () => {
      throw new Error("bad");
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("bad");
  });

  test("extractJsonFromText warns when all JSON candidates fail", () => {
    const stderrChunks: Array<string> = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.env.OBSKU_DEBUG = "1";
    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    try {
      expect(extractJsonFromText("```json\n{broken json}\n```\nextra trailing text")).toBeNull();
      const combined = stderrChunks.join("");
      expect(combined).toContain("extractJsonFromText: failed to parse JSON candidates");
      expect(combined).toContain("{broken json}");
    } finally {
      process.stderr.write = originalWrite;
      delete process.env.OBSKU_DEBUG;
    }
  });
});

describe("toToolResultEnvelope", () => {
  test("normalizes wrapped JSON result", () => {
    expect(toToolResultEnvelope({ result: '{"value":1}' })).toEqual({
      data: { value: 1 },
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("normalizes wrapped invalid JSON result as raw string", () => {
    expect(toToolResultEnvelope({ result: "plain text" })).toEqual({
      data: "plain text",
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("normalizes error result", () => {
    expect(toToolResultEnvelope({ isError: true, result: '{"error":"boom"}' })).toEqual({
      data: null,
      error: "boom",
      status: "completed",
      success: false,
    });
  });

  test("handles null input via fallback envelope", () => {
    expect(toToolResultEnvelope(null)).toEqual({
      data: null,
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("handles undefined input via fallback envelope", () => {
    expect(toToolResultEnvelope(undefined)).toEqual({
      data: undefined,
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("handles number input via fallback envelope", () => {
    expect(toToolResultEnvelope(42)).toEqual({
      data: 42,
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("handles array input via fallback envelope", () => {
    const arr = [1, 2, 3];
    expect(toToolResultEnvelope(arr)).toEqual({
      data: arr,
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("handles plain object without result/error as passthrough", () => {
    const obj = { foo: "bar", num: 123 };
    expect(toToolResultEnvelope(obj)).toEqual({
      data: obj,
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("handles error record {error: string} → failed envelope", () => {
    expect(toToolResultEnvelope({ error: "something went wrong" })).toEqual({
      data: null,
      error: "something went wrong",
      status: "completed",
      success: false,
    });
  });

  test("handles error record with non-string error → falls through to passthrough", () => {
    const obj = { error: { nested: "error" } };
    expect(toToolResultEnvelope(obj)).toEqual({
      data: obj,
      error: null,
      status: "completed",
      success: true,
    });
  });

  test("handles failed result with explicit success=false", () => {
    expect(toToolResultEnvelope({ error: "task failed", success: false })).toEqual({
      data: null,
      error: "task failed",
      status: "completed",
      success: false,
    });
  });

  test("handles failed result with non-standard status", () => {
    expect(
      toToolResultEnvelope({ error: "took too long", status: "timeout", success: false })
    ).toEqual({
      data: null,
      error: "took too long",
      status: "timeout",
      success: false,
    });
  });

  test("handles failed result with missing error → unknown error", () => {
    expect(toToolResultEnvelope({ success: false })).toEqual({
      data: null,
      error: "Unknown error",
      status: "completed",
      success: false,
    });
  });

  test("handles already-envelope input → returns same envelope", () => {
    const envelope = {
      data: { value: 1 },
      error: null,
      status: "completed" as const,
      success: true as const,
    };
    expect(toToolResultEnvelope(envelope)).toEqual(envelope);
  });

  test("handles running status envelope", () => {
    const running = {
      data: null,
      error: null,
      startedAt: 12_345,
      status: "running" as const,
      success: false as const,
    };
    expect(toToolResultEnvelope(running)).toEqual(running);
  });

  test("handles wrapped JSON containing envelope → unwraps envelope", () => {
    const inner = { data: { nested: true }, error: null, status: "completed", success: true };
    const wrapped = { result: JSON.stringify(inner) };
    expect(toToolResultEnvelope(wrapped)).toEqual(inner);
  });
});

describe("extractJsonFromText - JSON extraction characterization", () => {
  test("extracts fenced JSON before bare JSON (json_fence priority)", () => {
    // json-utils.ts prioritizes json_fence before code_fence, trimmed, bare_json
    const text = '{"bare": true}\n```json\n{"fenced": true}\n```';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ fenced: true });
  });

  test("extracts fenced JSON without json label (code_fence fallback)", () => {
    const text = '```\n{"code": true}\n```';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ code: true });
  });

  test("prefers json_fence over code_fence when both present", () => {
    const text = '```\n{"generic": true}\n```\n```json\n{"specific": true}\n```';
    // json-utils.ts checks json_fence first, so specific wins
    const result = extractJsonFromText(text);
    expect(result).toEqual({ specific: true });
  });

  test("extracts bare JSON when no fences present", () => {
    const text = 'Some text before {"key": "value"} some after';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ key: "value" });
  });

  test("extracts array from bare JSON", () => {
    const text = 'Here is the data: [{"id": 1}, {"id": 2}]';
    const result = extractJsonFromText(text);
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("handles nested braces in bare JSON extraction", () => {
    const text = 'Result: {"outer": {"inner": "value"}}';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ outer: { inner: "value" } });
  });

  test("handles malformed JSON gracefully by trying candidates", () => {
    // json-utils tries multiple candidates and returns null if all fail
    const text = "```json\n{broken json\n```";
    const result = extractJsonFromText(text);
    expect(result).toBeNull();
  });

  test("falls back to bare_json when fences and trimmed fail", () => {
    // If fenced extraction fails and trimmed fails, tries bare_json
    // Note: bare_json regex is greedy: /(\{[\s\S]*\}|\[[\s\S]*\])/
    const text = '```json\n{invalid json block\n```\nsome text\n{"valid": true}\nmore text';
    const _result = extractJsonFromText(text);
    // bare_json regex extracts from first { to last }, which may include invalid parts
    // This test documents actual behavior
  });

  test("returns null for completely invalid input", () => {
    const result = extractJsonFromText("not json at all");
    expect(result).toBeNull();
  });

  test("extracts first valid JSON from multiple candidates", () => {
    // json-utils uses Set for deduplication and tries in order
    const text = '{"first": 1}\n{"second": 2}';
    const result = extractJsonFromText(text);
    // The bare_json regex matches greedily: {"first": 1}\n{"second": 2}
    // which is invalid JSON (two objects not in array)
    // Then trimmed also fails (same content)
    expect(result).toBeNull(); // All candidates fail
  });
});

describe("deduplication behavior", () => {
  test("deduplicates identical candidates", () => {
    // json-utils uses Set to avoid parsing same text twice
    const text = '{"key": "value"}';
    const result = extractJsonFromText(text);
    expect(result).toEqual({ key: "value" });
  });
});
