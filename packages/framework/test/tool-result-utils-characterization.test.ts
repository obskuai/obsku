/**
 * Characterization tests for tool-result-utils.ts
 *
 * Purpose: Document and pin the CURRENT behaviour of every envelope family
 * accepted by `toToolResultEnvelope` and `normalizeToolResultPayload`.
 * These tests establish a green baseline before any simplification of the
 * normalization logic (Task 9). They must NOT be modified to make the tests
 * pass — if a test fails it means the implementation changed.
 *
 * Envelope families covered:
 *  1. Canonical envelope        – the ToolResultEnvelope<T> union type
 *  2. Failed envelope-like      – objects with `success: false` that are not
 *                                 fully canonical (missing `data: null`, etc.)
 *  3. Wrapped tool payload      – objects with `result: string` (legacy)
 *  4. Raw values                – primitives and unrecognised objects
 *  5. Malformed values          – shapes that intentionally look like envelopes
 *                                 but are subtly wrong
 *
 * See also:
 *  - packages/framework/src/tool-result-utils.ts  (implementation)
 *  - packages/framework/test/tool-output-types.test.ts  (ToolOutput shape)
 */

import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { buildSingleToolEffect, normalizeToolResult } from "../src/agent/result-normalization";
import {
  isToolOutput,
  normalizeToolResultPayload,
  toToolResultEnvelope,
  toToolResultOutput,
} from "../src/tool-result-utils";
import type { ToolUseContent } from "../src/types";
import { defaultConfig } from "./utils/helpers";

const toolCall: ToolUseContent = {
  input: {},
  name: "characterization-tool",
  toolUseId: "tu-characterization",
  type: "tool_use",
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Canonical envelope shapes
// ─────────────────────────────────────────────────────────────────────────────

describe("tool-result-utils characterization", () => {
  describe("canonical envelope shapes", () => {
    it("passes through a success envelope unchanged", () => {
      const input = {
        data: { port: 80 },
        error: null,
        status: "completed",
        success: true,
      } as const;
      const result = toToolResultEnvelope(input);
      expect(result).toEqual(input);
      expect(result.success).toBe(true);
    });

    it("passes through a completed-failed envelope unchanged", () => {
      const input = {
        data: null,
        error: "tool timed out",
        status: "completed",
        success: false,
      } as const;
      const result = toToolResultEnvelope(input);
      expect(result).toMatchObject(input);
      expect(result.success).toBe(false);
    });

    it("passes through a 'failed' status envelope unchanged", () => {
      const input = {
        data: null,
        error: "task failed",
        status: "failed",
        success: false,
      } as const;
      const result = toToolResultEnvelope(input);
      expect(result).toMatchObject(input);
    });

    it("passes through a 'not_found' status envelope unchanged", () => {
      const input = {
        data: null,
        error: "not found",
        status: "not_found",
        success: false,
      } as const;
      const result = toToolResultEnvelope(input);
      expect(result).toEqual(input);
    });

    it("passes through a 'timeout' status envelope unchanged", () => {
      const input = {
        data: null,
        error: "timed out",
        status: "timeout",
        success: false,
      } as const;
      const result = toToolResultEnvelope(input);
      expect(result).toEqual(input);
    });

    it("passes through a 'running' envelope unchanged", () => {
      const input = {
        data: null,
        error: null,
        startedAt: 1_700_000_000,
        status: "running",
        success: false,
      } as const;
      const result = toToolResultEnvelope(input);
      expect(result).toEqual(input);
    });

    it("accepts a canonical success envelope with null data field", () => {
      // data may be null for tools that return nothing meaningful
      const input = {
        data: null,
        error: null,
        status: "completed",
        success: true,
      } as const;
      const result = toToolResultEnvelope(input);
      expect(result).toEqual(input);
      expect(result.success).toBe(true);
    });

    it("accepts a canonical success envelope with complex data", () => {
      const data = { openPorts: [22, 80], os: "Linux", target: "10.0.0.1" };
      const input = { data, error: null, status: "completed", success: true };
      const result = toToolResultEnvelope(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(data);
      }
    });

    it("canonical failed envelope with null error routes to failed-envelope-like parser", () => {
      // error: null with a terminal status is not a canonical ToolResultEnvelope shape;
      // it falls through to parseFailedEnvelopeLikeEnvelope which coerces null → "Unknown error"
      const input = {
        data: null,
        error: null,
        status: "failed",
        success: false,
      } as const;
      const result = toToolResultEnvelope(input);
      expect(result).toMatchObject({
        data: null,
        error: "Unknown error",
        status: "failed",
        success: false,
      });
      expect(result.success).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Failed envelope-like payloads
  // ─────────────────────────────────────────────────────────────────────────

  describe("failed envelope like payloads", () => {
    it("normalises {success:false, error:string} without status/data fields", () => {
      // This is NOT canonical (no `data` field, no `status`).
      // The fallback parser accepts it and normalises to "completed".
      const result = toToolResultEnvelope({ error: "boom", success: false });
      expect(result).toMatchObject({
        data: null,
        error: "boom",
        status: "completed",
        success: false,
      });
    });

    it("normalises {success:false, error:string, status:'failed'} without data", () => {
      // Missing `data: null` makes it non-canonical; fallback parser picks it up.
      const result = toToolResultEnvelope({
        error: "task failed",
        status: "failed",
        success: false,
      });
      expect(result).toMatchObject({
        data: null,
        error: "task failed",
        status: "failed",
        success: false,
      });
    });

    it("normalises a running-like payload without all required running fields", () => {
      // Has `status:'running'` and `startedAt` but no `data`/`error` → falls to
      // parseFailedEnvelopeLikeValue which emits the running shape.
      const result = toToolResultEnvelope({
        startedAt: 12_345,
        status: "running",
        success: false,
      });
      expect(result).toMatchObject({
        data: null,
        error: null,
        startedAt: 12_345,
        status: "running",
        success: false,
      });
    });

    it("converts object error field to JSON string in failed-envelope-like", () => {
      // error is an object, not a string → toErrorMessage(record.error) → JSON.stringify
      const result = toToolResultEnvelope({
        error: { code: 500, message: "server error" },
        success: false,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(JSON.stringify({ code: 500, message: "server error" }));
        expect(result.status).toBe("completed");
      }
    });

    it("normalises unknown status to 'completed' in failed-envelope-like", () => {
      const result = toToolResultEnvelope({
        error: "bad thing",
        status: "unknown-custom-status",
        success: false,
      });
      expect(result.success).toBe(false);
      if (!result.success && result.status !== "running") {
        expect(result.status).toBe("completed");
      }
    });

    it("normalises null error to 'Unknown error' string in failed-envelope-like without data field", () => {
      // `success: false` and `error: null` — no `data` field so not canonical running.
      // `toErrorMessage(null)` → "Unknown error"
      const result = toToolResultEnvelope({ error: null, success: false });
      expect(result.success).toBe(false);
      if (!result.success && result.status !== "running") {
        expect(result.error).toBe("Unknown error");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Wrapped tool payloads (legacy {result: string, isError?: boolean})
  // ─────────────────────────────────────────────────────────────────────────

  describe("wrapped tool payloads", () => {
    it("prefers nested canonical envelope over conflicting isError flag", () => {
      const inner = {
        data: { message: "inner success" },
        error: null,
        status: "completed",
        success: true,
      } as const;
      const result = toToolResultEnvelope({ isError: true, result: JSON.stringify(inner) });
      expect(result).toEqual(inner);
    });

    it("prefers nested failed canonical envelope over conflicting isError false flag", () => {
      const inner = {
        data: null,
        error: "inner failure",
        status: "failed",
        success: false,
      } as const;
      const result = toToolResultEnvelope({ isError: false, result: JSON.stringify(inner) });
      expect(result).toEqual(inner);
    });

    it("wraps a plain string result as success when isError is false", () => {
      const result = toToolResultEnvelope({ isError: false, result: "plain text output" });
      expect(result).toMatchObject({
        data: "plain text output",
        error: null,
        status: "completed",
        success: true,
      });
    });

    it("wraps a JSON string result as parsed data when isError is false", () => {
      const data = { exitCode: 0, stdout: "hello" };
      const result = toToolResultEnvelope({ isError: false, result: JSON.stringify(data) });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(data);
      }
    });

    it("wraps a plain string result as success when isError is absent", () => {
      // isError defaults to undefined → treated as non-error
      const result = toToolResultEnvelope({ result: "implicit success" });
      expect(result.success).toBe(true);
    });

    it("converts to failed envelope when isError is true and result is a plain string", () => {
      // result is not valid JSON → error = parsed.data which is the raw string
      const result = toToolResultEnvelope({ isError: true, result: "connection refused" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("connection refused");
        expect(result.status).toBe("completed");
      }
    });

    it("converts to failed envelope when isError is true and result is JSON with error field", () => {
      const result = toToolResultEnvelope({
        isError: true,
        result: JSON.stringify({ error: "host unreachable" }),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("host unreachable");
      }
    });

    it("unwraps nested canonical envelope encoded inside result string", () => {
      const inner = {
        data: { scan: "complete" },
        error: null,
        status: "completed",
        success: true,
      } as const;
      const result = toToolResultEnvelope({ result: JSON.stringify(inner) });
      // The inner canonical envelope is unwrapped and returned directly
      expect(result).toEqual(inner);
      expect(result.success).toBe(true);
    });

    it("unwraps nested failed canonical envelope from result string", () => {
      const inner = {
        data: null,
        error: "inner failure",
        status: "failed",
        success: false,
      } as const;
      const result = toToolResultEnvelope({ result: JSON.stringify(inner) });
      expect(result).toEqual(inner);
    });

    it("preserves raw result string as data when JSON parse fails", () => {
      const result = toToolResultEnvelope({ result: "not-json{{{" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("not-json{{{");
      }
    });

    it("treats isError:true with invalid JSON result as error with raw string", () => {
      const result = toToolResultEnvelope({ isError: true, result: "not-json{{{" });
      expect(result.success).toBe(false);
      if (!result.success) {
        // parsed.data is the raw string from safeJsonParse when it fails
        expect(typeof result.error).toBe("string");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Raw values (no recognised envelope shape)
  // ─────────────────────────────────────────────────────────────────────────

  describe("raw values", () => {
    it("wraps a plain string as a completed success", () => {
      const result = toToolResultEnvelope("hello world");
      expect(result).toMatchObject({
        data: "hello world",
        error: null,
        status: "completed",
        success: true,
      });
    });

    it("wraps a number as a completed success", () => {
      const result = toToolResultEnvelope(42);
      expect(result).toMatchObject({ data: 42, error: null, status: "completed", success: true });
    });

    it("wraps null as a completed success", () => {
      const result = toToolResultEnvelope(null);
      expect(result).toMatchObject({ data: null, error: null, status: "completed", success: true });
    });

    it("wraps undefined as a completed success", () => {
      const result = toToolResultEnvelope(undefined);
      expect(result).toMatchObject({
        data: undefined,
        error: null,
        status: "completed",
        success: true,
      });
    });

    it("wraps an unrecognised plain object as a completed success", () => {
      const obj = { command: "nmap", target: "10.0.0.1" };
      const result = toToolResultEnvelope(obj);
      expect(result).toMatchObject({ data: obj, error: null, status: "completed", success: true });
    });

    it("wraps an empty object as a completed success", () => {
      const result = toToolResultEnvelope({});
      expect(result).toMatchObject({ data: {}, error: null, status: "completed", success: true });
    });

    it("wraps an array as a completed success", () => {
      const arr = [1, 2, 3];
      const result = toToolResultEnvelope(arr);
      expect(result).toMatchObject({ data: arr, error: null, status: "completed", success: true });
    });

    it("wraps a boolean false as a completed success (not treated as falsy failure)", () => {
      const result = toToolResultEnvelope(false);
      expect(result).toMatchObject({
        data: false,
        error: null,
        status: "completed",
        success: true,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Malformed values (subtly wrong shapes)
  // ─────────────────────────────────────────────────────────────────────────

  describe("malformed tool result payload", () => {
    it("prefers canonical envelope parsing over legacy wrapped keys on the same object", () => {
      // When a record has canonical envelope fields plus legacy wrapper fields (isError, result),
      // the canonical parse wins. Explicit construction returns only canonical fields.
      const input = {
        data: { ok: true },
        error: null,
        isError: true,
        result: "legacy payload should be ignored",
        status: "completed",
        success: true,
      } as const;
      const result = toToolResultEnvelope(input);
      expect(result).toMatchObject({
        data: { ok: true },
        error: null,
        status: "completed",
        success: true,
      });
      // Legacy fields are not forwarded to the envelope
      expect((result as Record<string, unknown>).isError).toBeUndefined();
      expect((result as Record<string, unknown>).result).toBeUndefined();
    });

    it("prefers failed-envelope-like parsing over wrapped result when success:false is present", () => {
      const result = toToolResultEnvelope({
        error: "failed envelope wins",
        result: JSON.stringify({ ignored: true }),
        success: false,
      });
      expect(result).toEqual({
        data: null,
        error: "failed envelope wins",
        status: "completed",
        success: false,
      });
    });

    it("rejects success:string (not boolean) and falls to raw wrap", () => {
      // success must be the boolean true or false — string "true" is not accepted
      const input = { data: "x", error: null, status: "completed", success: "true" };
      const result = toToolResultEnvelope(input);
      // Not canonical → falls through all parsers → raw wrap
      expect(result.success).toBe(true); // the WRAPPER success, data = input
      if (result.success) {
        expect(result.data).toEqual(input);
      }
    });

    it("rejects result:number (not string) in wrapped payload and falls to raw wrap", () => {
      const input = { isError: false, result: 42 };
      const result = toToolResultEnvelope(input);
      // isWrappedToolResultPayload requires result to be a string → falls through
      // parseErrorRecord: no `error` string field → falls through
      // wrapRawValueAsCompletedSuccess
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(input);
      }
    });

    it("rejects error:number (not string) in error-record and falls to raw wrap", () => {
      const input = { error: 404 };
      const result = toToolResultEnvelope(input);
      // isErrorRecord requires error to be a string → falls through to raw wrap
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(input);
      }
    });

    it("rejects success:false with no other fields — treated as failed-envelope-like", () => {
      // Minimal object with just `success: false`
      const result = toToolResultEnvelope({ success: false });
      expect(result.success).toBe(false);
      if (!result.success && result.status !== "running") {
        expect(result.status).toBe("completed");
        // error = toErrorMessage(undefined) → JSON.stringify(undefined) = undefined → "Unknown error"
        expect(result.error).toBe("Unknown error");
      }
    });

    it("rejects running envelope with non-number startedAt — not canonical", () => {
      // startedAt must be a number for canonical running envelope
      const input = {
        data: null,
        error: null,
        startedAt: "2024-01-01",
        status: "running",
        success: false,
      };
      const result = toToolResultEnvelope(input);
      // isToolResultEnvelope returns false (startedAt is not number)
      // parseFailedEnvelopeLikeValue: success===false, status===running, startedAt is not number
      // → falls to normal failed branch
      expect(result.success).toBe(false);
    });

    it("accepts an object with {error:string} at top level as an error-record", () => {
      // parseErrorRecord catches { error: string } objects
      const input = { error: "something went wrong" };
      const result = toToolResultEnvelope(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("something went wrong");
        expect(result.status).toBe("completed");
      }
    });

    it("rejects canonical-like envelope with wrong status string — falls to raw wrap", () => {
      // Status "processing" is not in the allowed set for canonical failed envelopes
      // AND success is not true/false boolean → goes to raw wrap
      const input = { data: null, error: null, status: "processing", success: true };
      // success === true, status !== "completed" → isToolResultEnvelope returns false
      const result = toToolResultEnvelope(input);
      // success:true but status:"processing" is not "completed" → not canonical
      // → falls to parseFailedEnvelopeLikeValue (checks success !== false → null)
      // → falls to parseWrappedToolPayload (no result string → null)
      // → falls to parseErrorRecord (error is null not string → null)
      // → wrapRawValueAsCompletedSuccess
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(input);
      }
    });

    it("treats an object with content+isError keys as a ToolOutput boundary", () => {
      const input = { content: "scan output", isError: false };
      const result = toToolResultEnvelope(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual("scan output");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. normalizeToolResultPayload — legacy normalization
  // ─────────────────────────────────────────────────────────────────────────

  describe("normalizeToolResultPayload - legacy normalization", () => {
    it("normalises a ToolExecutionResultPayload (has result+isError+toolName+toolUseId)", () => {
      const input = {
        isError: true,
        result: JSON.stringify({ error: "failed" }),
        toolName: "nmap",
        toolUseId: "tu-1",
      };
      const out = normalizeToolResultPayload(input);
      expect(out).toEqual({ isError: true, result: input.result });
    });

    it("normalises a wrapped payload (result+isError, no toolName/toolUseId)", () => {
      const input = { isError: false, result: "scan complete" };
      const out = normalizeToolResultPayload(input);
      expect(out).toEqual({ isError: false, result: "scan complete" });
    });

    it("defaults isError to false when missing from wrapped payload", () => {
      const out = normalizeToolResultPayload({ result: "ok" });
      expect(out).toEqual({ isError: false, result: "ok" });
    });

    it("normalises a ToolOutput {content, isError} shape", () => {
      const input = { content: "tool returned this", isError: false };
      const out = normalizeToolResultPayload(input);
      expect(out).toEqual({ isError: false, result: "tool returned this" });
    });

    it("defaults isError to false for ToolOutput without isError field", () => {
      const out = normalizeToolResultPayload({ content: "result" });
      expect(out).toEqual({ isError: false, result: "result" });
    });

    it("returns null for unrecognised values (plain string)", () => {
      expect(normalizeToolResultPayload("hello")).toBeNull();
    });

    it("returns null for a canonical ToolResultEnvelope (not a legacy payload)", () => {
      const envelope = { data: { x: 1 }, error: null, status: "completed", success: true };
      expect(normalizeToolResultPayload(envelope)).toBeNull();
    });

    it("returns null for null input", () => {
      expect(normalizeToolResultPayload(null)).toBeNull();
    });

    it("returns null for undefined input", () => {
      expect(normalizeToolResultPayload(undefined)).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. toToolResultOutput — shape adapter
  // ─────────────────────────────────────────────────────────────────────────

  describe("toToolResultOutput - output adapter", () => {
    it("extracts content from a wrapped payload", () => {
      const out = toToolResultOutput({ isError: false, result: "tool done" });
      expect(out).toEqual({ content: "tool done", isError: false });
    });

    it("extracts content from a ToolOutput shape", () => {
      const out = toToolResultOutput({ content: "raw output" });
      expect(out).toEqual({ content: "raw output", isError: false });
    });

    it("JSON-stringifies plain objects when no normalisation matches", () => {
      const obj = { foo: "bar" };
      const out = toToolResultOutput(obj);
      expect(out).toEqual({ content: JSON.stringify(obj), isError: false });
    });

    it("passes plain strings through as content", () => {
      const out = toToolResultOutput("plain string");
      expect(out).toEqual({ content: "plain string", isError: false });
    });

    it("JSON-stringifies numbers", () => {
      const out = toToolResultOutput(99);
      expect(out).toEqual({ content: "99", isError: false });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. isToolOutput — type guard
  // ─────────────────────────────────────────────────────────────────────────

  describe("isToolOutput - type guard", () => {
    it("returns true for {content:string}", () => {
      expect(isToolOutput({ content: "ok" })).toBe(true);
    });

    it("returns true for {content:string, isError:boolean}", () => {
      expect(isToolOutput({ content: "ok", isError: true })).toBe(true);
    });

    it("returns false for objects with more than 2 keys", () => {
      expect(isToolOutput({ content: "ok", extra: 1, isError: false })).toBe(false);
    });

    it("returns false for objects with 2 keys where second key is not isError", () => {
      expect(isToolOutput({ content: "ok", other: "x" })).toBe(false);
    });

    it("returns false when content is not a string", () => {
      expect(isToolOutput({ content: 42 })).toBe(false);
    });

    it("returns false for null", () => {
      expect(isToolOutput(null)).toBe(false);
    });

    it("returns false for plain strings", () => {
      expect(isToolOutput("string")).toBe(false);
    });

    it("returns false for empty object", () => {
      expect(isToolOutput({})).toBe(false);
    });
  });

  describe("downstream caller expectations", () => {
    it("normalizeToolResult still ignores canonical success envelopes", () => {
      expect(
        normalizeToolResult({
          data: { nested: true },
          error: null,
          status: "completed",
          success: true,
        })
      ).toBeNull();
    });

    it("normalizeToolResult still ignores canonical failed envelopes", () => {
      expect(
        normalizeToolResult({
          data: null,
          error: "boom",
          status: "failed",
          success: false,
        })
      ).toBeNull();
    });

    it("buildSingleToolEffect stringifies canonical success envelopes through shared output normalization", async () => {
      const result = await Effect.runPromise(
        buildSingleToolEffect(
          Effect.succeed({
            data: { nested: true },
            error: null,
            status: "completed",
            success: true,
          }),
          toolCall,
          defaultConfig
        )
      );

      expect(result).toEqual({
        isError: false,
        result: JSON.stringify({
          data: { nested: true },
          error: null,
          status: "completed",
          success: true,
        }),
        toolName: "characterization-tool",
        toolUseId: "tu-characterization",
      });
    });

    it("buildSingleToolEffect preserves canonical failed envelopes through shared output normalization", async () => {
      const result = await Effect.runPromise(
        buildSingleToolEffect(
          Effect.succeed({
            data: null,
            error: "boom",
            status: "failed",
            success: false,
          }),
          toolCall,
          defaultConfig
        )
      );

      expect(result).toEqual({
        isError: true,
        result: JSON.stringify({ data: null, error: "boom", status: "failed", success: false }),
        toolName: "characterization-tool",
        toolUseId: "tu-characterization",
      });
    });
  });
});
