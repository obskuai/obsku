/**
 * Characterization tests for tool-result-utils.ts — negative / error paths.
 *
 * Purpose (Task 5 / Wave 1): Pin the current behaviour of normalizeToolResultBoundary
 * and toToolResultOutput for error-flagged and "running" envelopes.
 * Complements the existing characterization file which focuses on envelope
 * parsing; this file focuses on output.isError flag propagation.
 *
 * Rules:
 *  - Tests are READ-ONLY observers; production source files are NOT modified.
 *  - Each test documents exactly which code path leads to the observed result.
 */

import { describe, expect, it } from "bun:test";
import {
  normalizeToolResultBoundary,
  toToolResultEnvelope,
  toToolResultOutput,
} from "../src/tool-result-utils";

// ---------------------------------------------------------------------------
// toToolResultOutput — isError flag propagation (negative paths)
// ---------------------------------------------------------------------------

describe("toToolResultOutput error-flag characterization", () => {
  it("marks output.isError=true for a failed canonical envelope", () => {
    const input = {
      data: null,
      error: "tool timed out",
      status: "timeout",
      success: false,
    } as const;
    const out = toToolResultOutput(input);
    // Pin: failed canonical envelopes propagate isError=true to the caller
    expect(out.isError).toBe(true);
    expect(out.content).toBe(JSON.stringify(input));
  });

  it("marks output.isError=false for a success canonical envelope", () => {
    const input = {
      data: { result: "ok" },
      error: null,
      status: "completed",
      success: true,
    } as const;
    const out = toToolResultOutput(input);
    // Pin: success envelopes yield isError=false
    expect(out.isError).toBe(false);
  });

  it("marks output.isError=false for a 'running' envelope (running is NOT an error)", () => {
    const input = {
      data: null,
      error: null,
      startedAt: 1_000_000,
      status: "running",
      success: false,
    } as const;
    const out = toToolResultOutput(input);
    // Pin: running status is explicitly excluded from error treatment
    // isEnvelopeError() returns false when status === "running"
    expect(out.isError).toBe(false);
  });

  it("marks output.isError=true for a failed-envelope-like (success:false, non-running)", () => {
    const input = { error: "something broke", success: false };
    const out = toToolResultOutput(input);
    // Pin: failed-envelope-like objects with success=false and non-running status → error
    expect(out.isError).toBe(true);
  });

  it("marks output.isError=true for a wrapped payload with isError=true", () => {
    const out = toToolResultOutput({ isError: true, result: "failed result" });
    // Pin: the isError flag from a wrapped payload propagates to output
    expect(out.isError).toBe(true);
    expect(out.content).toBe("failed result");
  });

  it("marks output.isError=false for a wrapped payload with isError=false", () => {
    const out = toToolResultOutput({ isError: false, result: "ok result" });
    // Pin: isError=false propagates correctly
    expect(out.isError).toBe(false);
    expect(out.content).toBe("ok result");
  });

  it("marks output.isError=false for a plain string (raw value path)", () => {
    const out = toToolResultOutput("plain output");
    // Pin: raw strings are wrapped as success, isError defaults to false
    expect(out.isError).toBe(false);
    expect(out.content).toBe("plain output");
  });

  it("marks output.isError=false for a ToolOutput with isError explicitly false", () => {
    // ToolOutput has exactly {content: string} or {content: string, isError: boolean}
    const out = toToolResultOutput({ content: "tool output", isError: false });
    expect(out.isError).toBe(false);
  });

  it("marks output.isError=true for a ToolOutput with isError=true", () => {
    const out = toToolResultOutput({ content: "error output", isError: true });
    // Pin: ToolOutput's isError field is respected
    expect(out.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeToolResultBoundary — output.content serialization (negative paths)
// ---------------------------------------------------------------------------

describe("normalizeToolResultBoundary content serialization characterization", () => {
  it("serializes a failed canonical envelope as full JSON in output.content", () => {
    const input = {
      data: null,
      error: "not found",
      status: "not_found",
      success: false,
    } as const;
    const boundary = normalizeToolResultBoundary(input);
    // Pin: the envelope is serialized as JSON for the content field
    expect(boundary.output.content).toBe(JSON.stringify(input));
    expect(boundary.output.isError).toBe(true);
  });

  it("uses the result string directly as content for a wrapped payload", () => {
    const boundary = normalizeToolResultBoundary({ isError: false, result: "raw result" });
    // Pin: wrapped payload's result string becomes the content verbatim
    expect(boundary.output.content).toBe("raw result");
  });

  it("serializes plain object as JSON when falling to raw-value path", () => {
    const obj = { command: "nmap", target: "10.0.0.1" };
    const boundary = normalizeToolResultBoundary(obj);
    // Pin: unrecognised objects fall to wrapRawValueAsCompletedSuccess,
    //      and serializeToolResultContent JSON.stringifies them
    expect(boundary.output.content).toBe(JSON.stringify(obj));
    expect(boundary.output.isError).toBe(false);
  });

  it("error-record {error:string} serializes the full object as content", () => {
    const input = { error: "something went wrong" };
    const boundary = normalizeToolResultBoundary(input);
    // Pin: error-record path serializes the original object as content
    expect(boundary.output.content).toBe(JSON.stringify(input));
    expect(boundary.output.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toToolResultEnvelope — error path round-trip (negative paths)
// ---------------------------------------------------------------------------

describe("toToolResultEnvelope error path characterization", () => {
  it("error in a wrapped result JSON string is extracted as the envelope error", () => {
    // When result contains a JSON object with an error field, the error is extracted
    const result = toToolResultEnvelope({
      isError: true,
      result: JSON.stringify({ error: "connection refused" }),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Pin: error string is extracted from the nested JSON, not stringified
      expect(result.error).toBe("connection refused");
    }
  });

  it("non-JSON error result string becomes the error message verbatim", () => {
    const result = toToolResultEnvelope({ isError: true, result: "plain error text" });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Pin: raw string (non-JSON) becomes the error field directly
      expect(result.error).toBe("plain error text");
    }
  });

  it("a null error in failed-envelope-like normalizes to 'Unknown error'", () => {
    // { success: false, error: null } → no data field → failed-envelope-like path
    // toErrorMessage(null) → "Unknown error"
    const result = toToolResultEnvelope({ error: null, success: false });
    expect(result.success).toBe(false);
    if (!result.success && result.status !== "running") {
      expect(result.error).toBe("Unknown error");
    }
  });

  it("object error field is JSON.stringified in failed-envelope-like", () => {
    const errObj = { code: 503, message: "Service Unavailable" };
    const result = toToolResultEnvelope({ error: errObj, success: false });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Pin: non-string errors are serialized via toErrorMessage → JSON.stringify
      expect(result.error).toBe(JSON.stringify(errObj));
    }
  });

  it("unknown status strings in failed-envelope-like normalize to 'completed'", () => {
    const result = toToolResultEnvelope({
      error: "problem",
      status: "my-custom-status",
      success: false,
    });
    expect(result.success).toBe(false);
    if (!result.success && result.status !== "running") {
      // Pin: unrecognized status strings are normalized to "completed"
      expect(result.status).toBe("completed");
    }
  });
});
