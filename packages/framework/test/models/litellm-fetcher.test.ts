import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fetchLiteLLMModels } from "../../src/models/litellm-fetcher";

const TEST_URL = "http://test.example.com/models.json";
const TEST_TIMEOUT = 5000;

let originalFetch: typeof global.fetch;

function createFetchMock(
  impl: (input: string | Request | URL, init?: RequestInit) => Promise<Response>
): typeof fetch {
  const mock = impl as unknown as typeof fetch;
  mock.preconnect = async () => {};
  return mock;
}

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("fetchLiteLLMModels", () => {
  test("returns error result on network failure", async () => {
    global.fetch = createFetchMock(async () => {
      throw new Error("Network error: connection refused");
    });

    const result = await fetchLiteLLMModels(TEST_URL, TEST_TIMEOUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("network");
      expect(result.error).toContain("Network error");
    }
  });

  test("returns error result on non-ok HTTP response", async () => {
    global.fetch = createFetchMock(
      async () => ({ json: async () => ({}), ok: false }) as unknown as Response
    );

    const result = await fetchLiteLLMModels(TEST_URL, TEST_TIMEOUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("http");
    }
  });

  test("returns error result on invalid JSON", async () => {
    global.fetch = createFetchMock(
      async () =>
        ({
          json: async () => {
            throw new SyntaxError("Unexpected token < in JSON");
          },
          ok: true,
        }) as unknown as Response
    );

    const result = await fetchLiteLLMModels(TEST_URL, TEST_TIMEOUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("network");
    }
  });

  test("returns error result when response is not a valid schema", async () => {
    // LiteLLMModelsSchema expects Record<string, object>, not a primitive
    global.fetch = createFetchMock(
      async () =>
        ({
          json: async () => "this is not a valid model map",
          ok: true,
        }) as unknown as Response
    );

    const result = await fetchLiteLLMModels(TEST_URL, TEST_TIMEOUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("parse");
    }
  });

  test("parses valid LiteLLM JSON and returns full map", async () => {
    const mockData = {
      "amazon.titan-embed-text-v2:0": {
        litellm_provider: "bedrock",
        max_input_tokens: 8192,
        mode: "embedding",
      },
      "anthropic.claude-3-sonnet-20240229-v1:0": {
        litellm_provider: "bedrock_converse",
        max_input_tokens: 200_000,
        max_output_tokens: 4096,
        mode: "chat",
      },
    };

    global.fetch = createFetchMock(
      async () =>
        ({
          json: async () => mockData,
          ok: true,
        }) as unknown as Response
    );

    const result = await fetchLiteLLMModels(TEST_URL, TEST_TIMEOUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Both entries should be present (fetcher returns the full map, filtering is done by registry)
      expect(result.data["anthropic.claude-3-sonnet-20240229-v1:0"]).toBeDefined();
      expect(result.data["anthropic.claude-3-sonnet-20240229-v1:0"].mode).toBe("chat");
      expect(result.data["anthropic.claude-3-sonnet-20240229-v1:0"].max_input_tokens).toBe(200_000);
      expect(result.data["anthropic.claude-3-sonnet-20240229-v1:0"].max_output_tokens).toBe(4096);
      expect(result.data["anthropic.claude-3-sonnet-20240229-v1:0"].litellm_provider).toBe(
        "bedrock_converse"
      );
      expect(result.data["amazon.titan-embed-text-v2:0"]).toBeDefined();
    }
  });

  test("strips unknown fields from model entries (Zod strip)", async () => {
    const mockData = {
      "anthropic.claude-3-haiku-20240307-v1:0": {
        litellm_provider: "bedrock_converse",
        max_input_tokens: 200_000,
        max_output_tokens: 4096,
        mode: "chat",
        pricing: { input: 0.000_25 },
        unknown_future_field: "should be stripped",
      },
    };

    global.fetch = createFetchMock(
      async () =>
        ({
          json: async () => mockData,
          ok: true,
        }) as unknown as Response
    );

    const result = await fetchLiteLLMModels(TEST_URL, TEST_TIMEOUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const entry = result.data["anthropic.claude-3-haiku-20240307-v1:0"];

      expect(entry).toBeDefined();
      expect(entry.max_input_tokens).toBe(200_000);
      // Unknown fields should be stripped by Zod schema
      expect((entry as Record<string, unknown>)["unknown_future_field"]).toBeUndefined();
      expect((entry as Record<string, unknown>)["pricing"]).toBeUndefined();
    }
  });

  test("handles partial model entries with missing optional fields", async () => {
    const mockData = {
      "partial.model-v1:0": {
        mode: "chat",
        // max_input_tokens and max_output_tokens omitted — they are optional in schema
      },
    };

    global.fetch = createFetchMock(
      async () =>
        ({
          json: async () => mockData,
          ok: true,
        }) as unknown as Response
    );

    const result = await fetchLiteLLMModels(TEST_URL, TEST_TIMEOUT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const entry = result.data["partial.model-v1:0"];

      expect(entry).toBeDefined();
      expect(entry.mode).toBe("chat");
      expect(entry.max_input_tokens).toBeUndefined();
      expect(entry.max_output_tokens).toBeUndefined();
    }
  });

  test("returns error result on timeout", async () => {
    // Mock fetch that listens to the AbortController signal and rejects on abort
    global.fetch = createFetchMock(async (_url: string | Request | URL, opts?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        opts?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
        // Never resolves otherwise — simulates a hung server
      });
    });

    // 1ms timeout → AbortController fires almost immediately
    const result = await fetchLiteLLMModels(TEST_URL, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("network");
    }
  });
});
