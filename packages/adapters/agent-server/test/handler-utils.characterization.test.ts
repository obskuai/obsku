/**
 * Characterization tests for handler-utils.ts error-response behavior.
 *
 * Purpose (Wave 1 / Task 5): Pin the current user-visible response shapes so
 * Wave-3 observability improvements cannot accidentally drift the API contract.
 *
 * Rules:
 *  - Tests are READ-ONLY observers; production source files are NOT modified.
 *  - Each test documents WHY the current behavior is the expected baseline.
 */

import { describe, expect, it } from "bun:test";
import type { LLMProvider } from "@obsku/framework";
import { HTTP_STATUS } from "../src/constants";
import { parseJsonRequest, resolveRequestProvider } from "../src/handler-utils";

// ---------------------------------------------------------------------------
// Minimal fake provider — only identity matters here
// ---------------------------------------------------------------------------
const stubProvider: LLMProvider = {
  chat: async () => ({
    content: [{ text: "stub", type: "text" }],
    stopReason: "end_turn",
    usage: { inputTokens: 0, outputTokens: 0 },
  }),
  chatStream: async function* () {},
  contextWindowSize: 1000,
};

// ---------------------------------------------------------------------------
// Helpers to build minimal Request objects
// ---------------------------------------------------------------------------
function makeRequest(body: string, contentType = "application/json"): Request {
  return new Request("http://localhost/test", {
    body,
    headers: { "Content-Type": contentType },
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// parseJsonRequest — invalid JSON characterization
// ---------------------------------------------------------------------------
describe("invalid JSON characterization", () => {
  it("returns ok:false with 400 and 'Invalid JSON' body for malformed JSON", async () => {
    const req = makeRequest("not-json");
    const result = await parseJsonRequest(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Pin: status code is always 400 BAD_REQUEST by default
      expect(result.response.status).toBe(HTTP_STATUS.BAD_REQUEST);

      // Pin: body is { error: "Invalid JSON" } — exact shape callers depend on
      const body = (await result.response.json()) as { error: string };
      expect(body.error).toBe("Invalid JSON");
    }
  });

  it("returns ok:false with 400 for truncated JSON object", async () => {
    const req = makeRequest('{"key": ');
    const result = await parseJsonRequest(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(HTTP_STATUS.BAD_REQUEST);
      const body = (await result.response.json()) as { error: string };
      expect(body.error).toBe("Invalid JSON");
    }
  });

  it("returns ok:false with 400 for empty body string", async () => {
    const req = makeRequest("");
    const result = await parseJsonRequest(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    }
  });

  it("custom invalidJsonMessage overrides the default 'Invalid JSON' text", async () => {
    const req = makeRequest("bad");
    const result = await parseJsonRequest(req, {
      invalidJsonMessage: "Body parse error",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = (await result.response.json()) as { error: string };
      // Pin: callers can supply a custom message that appears verbatim
      expect(body.error).toBe("Body parse error");
    }
  });

  it("custom status option overrides 400 when JSON is invalid", async () => {
    const req = makeRequest("bad");
    const result = await parseJsonRequest(req, { status: 422 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Pin: the caller controls the HTTP status code
      expect(result.response.status).toBe(422);
    }
  });

  it("writeErr is invoked when JSON parsing fails", async () => {
    const logged: Array<string> = [];
    const req = makeRequest("bad");
    await parseJsonRequest(req, { writeErr: (m) => logged.push(m) });

    // Pin: at least one non-empty log message is written
    expect(logged.length).toBeGreaterThan(0);
    expect(logged[0].length).toBeGreaterThan(0);
  });

  it("writeErr includes the tag when provided", async () => {
    const logged: Array<string> = [];
    const req = makeRequest("bad");
    await parseJsonRequest(req, {
      tag: "[MyTag]",
      writeErr: (m) => logged.push(m),
    });

    // Pin: the tag appears in the log message
    expect(logged[0]).toContain("[MyTag]");
  });

  it("returns ok:true with parsed body for valid JSON object", async () => {
    const req = makeRequest(JSON.stringify({ message: "hello" }));
    const result = await parseJsonRequest<{ message: string }>(req);

    // Pin: valid JSON takes the ok:true branch; body is accessible
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toEqual({ message: "hello" });
    }
  });
});

// ---------------------------------------------------------------------------
// resolveRequestProvider — factory/provider error characterization
// ---------------------------------------------------------------------------
describe("provider resolution characterization", () => {
  it("returns ok:false with 500 and 'Provider creation failed' when factory throws", async () => {
    const result = await resolveRequestProvider({
      defaultProvider: stubProvider,
      model: "some-model",
      providerFactory: () => {
        throw new Error("factory boom");
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Pin: provider failures surface as 500 Internal Server Error
      expect(result.response.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);

      const body = (await result.response.json()) as { error: string };
      // Pin: default message is "Provider creation failed"
      expect(body.error).toBe("Provider creation failed");
    }
  });

  it("custom failureMessage overrides the default error text", async () => {
    const result = await resolveRequestProvider({
      defaultProvider: stubProvider,
      failureMessage: "Cannot initialise LLM",
      model: "some-model",
      providerFactory: () => {
        throw new Error("factory boom");
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = (await result.response.json()) as { error: string };
      expect(body.error).toBe("Cannot initialise LLM");
    }
  });

  it("custom status option overrides 500 for factory failures", async () => {
    const result = await resolveRequestProvider({
      defaultProvider: stubProvider,
      model: "some-model",
      providerFactory: () => {
        throw new Error("factory boom");
      },
      status: 503,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
    }
  });

  it("writeErr is invoked when factory throws", async () => {
    const logged: Array<string> = [];
    await resolveRequestProvider({
      defaultProvider: stubProvider,
      model: "some-model",
      providerFactory: () => {
        throw new Error("boom");
      },
      writeErr: (m) => logged.push(m),
    });

    // Pin: at least one non-empty log message is emitted
    expect(logged.length).toBeGreaterThan(0);
    expect(logged[0].length).toBeGreaterThan(0);
  });

  it("writeErr includes the tag when provided", async () => {
    const logged: Array<string> = [];
    await resolveRequestProvider({
      defaultProvider: stubProvider,
      model: "some-model",
      providerFactory: () => {
        throw new Error("boom");
      },
      tag: "[ProviderTag]",
      writeErr: (m) => logged.push(m),
    });

    expect(logged[0]).toContain("[ProviderTag]");
  });

  it("returns ok:true with provider when factory succeeds", async () => {
    const customProvider: LLMProvider = { ...stubProvider, contextWindowSize: 999 };
    const result = await resolveRequestProvider({
      defaultProvider: stubProvider,
      model: "some-model",
      providerFactory: () => customProvider,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Pin: the exact provider returned by the factory is passed through
      expect(result.provider.contextWindowSize).toBe(999);
    }
  });

  it("returns default provider when no model is specified (factory is bypassed)", async () => {
    let factoryCalled = false;
    const result = await resolveRequestProvider({
      defaultProvider: stubProvider,
      providerFactory: () => {
        factoryCalled = true;
        return stubProvider;
      },
    });

    expect(result.ok).toBe(true);
    // Pin: factory must NOT run when no model is passed
    expect(factoryCalled).toBe(false);
    if (result.ok) {
      expect(result.provider).toBe(stubProvider);
    }
  });

  it("returns default provider when no factory is configured", async () => {
    const result = await resolveRequestProvider({
      defaultProvider: stubProvider,
      model: "some-model",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe(stubProvider);
    }
  });

  it("awaits async factory before resolving", async () => {
    let resolved = false;
    const asyncProvider: LLMProvider = { ...stubProvider, contextWindowSize: 42 };
    const result = await resolveRequestProvider({
      defaultProvider: stubProvider,
      model: "some-model",
      providerFactory: async () => {
        await new Promise((r) => setTimeout(r, 5));
        resolved = true;
        return asyncProvider;
      },
    });

    expect(result.ok).toBe(true);
    // Pin: async factory is fully awaited before the result is returned
    expect(resolved).toBe(true);
    if (result.ok) {
      expect(result.provider.contextWindowSize).toBe(42);
    }
  });
});
