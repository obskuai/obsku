import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ModelRegistry } from "../../src/models/registry";

let originalFetch: typeof global.fetch;

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// Helper to create a mock fetch that returns the given data
function makeMockFetch(data: Record<string, unknown>, ok = true): typeof fetch {
  return (async (_url: string | Request | URL, _opts?: RequestInit) =>
    ({
      json: async () => data,
      ok,
    }) as unknown as Response) as typeof fetch;
}

describe("ModelRegistry", () => {
  test("resolveSync returns cached data if fresh", async () => {
    // Mock fetch to return a model
    global.fetch = makeMockFetch({
      "novel.test-model-v1:0": {
        max_input_tokens: 100_000,
        max_output_tokens: 8192,
        mode: "chat",
      },
    });

    const registry = new ModelRegistry({ ttlMs: 60_000 });
    // Populate cache via resolve
    await registry.resolve("novel.test-model-v1:0");

    // resolveSync should now return the cached data
    const result = registry.resolveSync("novel.test-model-v1:0");
    expect(result).toBeDefined();
    expect(result?.contextWindowSize).toBe(100_000);
    expect(result?.maxOutputTokens).toBe(8192);
  });

  test("resolveSync returns undefined without cache", () => {
    const registry = new ModelRegistry();
    const result = registry.resolveSync("anthropic.claude-3-sonnet-20240229-v1:0");
    expect(result).toBeUndefined();
  });

  test("resolve fetches from network on cache miss", async () => {
    let fetchCalled = false;
    global.fetch = (async (_url: string | Request | URL, _opts?: RequestInit) => {
      fetchCalled = true;
      return { json: async () => ({}), ok: true } as unknown as Response;
    }) as typeof fetch;

    const registry = new ModelRegistry();
    await registry.resolve("unknown.never-seen-model-v1:0");
    expect(fetchCalled).toBe(true);
  });

  test("resolve returns undefined for truly unknown model", async () => {
    global.fetch = makeMockFetch({});

    const registry = new ModelRegistry();
    const result = await registry.resolve("unknown.model-v99:0");
    expect(result).toBeUndefined();
  });

  test("prefix stripping works for global.", async () => {
    global.fetch = makeMockFetch({
      "anthropic.claude-3-sonnet-20240229-v1:0": {
        max_input_tokens: 200_000,
        max_output_tokens: 4096,
        mode: "chat",
      },
    });
    const registry = new ModelRegistry({ ttlMs: 60_000 });
    await registry.resolve("anthropic.claude-3-sonnet-20240229-v1:0");
    const result1 = registry.resolveSync("global.anthropic.claude-3-sonnet-20240229-v1:0");
    const result2 = registry.resolveSync("anthropic.claude-3-sonnet-20240229-v1:0");
    expect(result1).toEqual(result2);
    expect(result1).toBeDefined();
  });

  test("prefix stripping works for regional prefixes", async () => {
    global.fetch = makeMockFetch({
      "anthropic.claude-3-sonnet-20240229-v1:0": {
        max_input_tokens: 200_000,
        max_output_tokens: 4096,
        mode: "chat",
      },
    });
    const registry = new ModelRegistry({ ttlMs: 60_000 });
    await registry.resolve("anthropic.claude-3-sonnet-20240229-v1:0");
    const base = registry.resolveSync("anthropic.claude-3-sonnet-20240229-v1:0");
    const us = registry.resolveSync("us.anthropic.claude-3-sonnet-20240229-v1:0");
    const eu = registry.resolveSync("eu.anthropic.claude-3-sonnet-20240229-v1:0");
    const apac = registry.resolveSync("apac.anthropic.claude-3-sonnet-20240229-v1:0");
    expect(base).toEqual(us);
    expect(base).toEqual(eu);
    expect(base).toEqual(apac);
  });

  test("fetch deduplication - concurrent calls share one fetch", async () => {
    let fetchCount = 0;
    global.fetch = (async (_url: string | Request | URL, _opts?: RequestInit) => {
      fetchCount++;
      // Small delay so both concurrent resolve() calls see fetchPromise already set
      await new Promise((r) => setTimeout(r, 10));
      return { json: async () => ({}), ok: true } as unknown as Response;
    }) as typeof fetch;

    const registry = new ModelRegistry({ ttlMs: 60_000 });
    // Both unknown models trigger fetchWithDedup; second call should reuse in-flight promise
    const [r1, r2] = await Promise.all([
      registry.resolve("unknown.model-alpha-v1:0"),
      registry.resolve("unknown.model-beta-v1:0"),
    ]);

    expect(fetchCount).toBe(1);
    expect(r1).toBeUndefined();
    expect(r2).toBeUndefined();
  });

  test("TTL expiration - stale cache returns undefined in resolveSync", async () => {
    global.fetch = makeMockFetch({
      "novel.expired-model-v1:0": {
        max_input_tokens: 50_000,
        max_output_tokens: 4096,
        mode: "chat",
      },
    });

    // TTL of 0: any cached entry is immediately stale (Date.now() - fetchedAt < 0 is always false)
    const registry = new ModelRegistry({ ttlMs: 0 });
    // Populate cache via resolve
    await registry.resolve("novel.expired-model-v1:0");

    // resolveSync: cache is stale (ttlMs=0) → undefined
    const result = registry.resolveSync("novel.expired-model-v1:0");
    expect(result).toBeUndefined();
  });

  // --- Version suffix fallback tests ---

  test("version suffix fallback: versioned query matches short LiteLLM key", async () => {
    // LiteLLM has short key (no version suffix)
    global.fetch = makeMockFetch({
      "anthropic.claude-sonnet-4-6": {
        max_input_tokens: 200_000,
        max_output_tokens: 64_000,
        mode: "chat",
      },
    });

    const registry = new ModelRegistry({ ttlMs: 60_000 });
    // Query with full Bedrock versioned ID
    const result = await registry.resolve("anthropic.claude-sonnet-4-6-20260315-v1:0");
    expect(result).toBeDefined();
    expect(result?.contextWindowSize).toBe(200_000);
    expect(result?.maxOutputTokens).toBe(64_000);
  });

  test("version suffix fallback: short query matches versioned LiteLLM key", async () => {
    // LiteLLM has versioned key
    global.fetch = makeMockFetch({
      "anthropic.claude-sonnet-4-5-20250929-v1:0": {
        max_input_tokens: 200_000,
        max_output_tokens: 64_000,
        mode: "chat",
      },
    });

    const registry = new ModelRegistry({ ttlMs: 60_000 });
    // Query with short base name — should find via base-name cache entry
    const result = await registry.resolve("anthropic.claude-sonnet-4-5");
    expect(result).toBeDefined();
    expect(result?.contextWindowSize).toBe(200_000);
    expect(result?.maxOutputTokens).toBe(64_000);
  });

  test("version suffix fallback: -vN suffix without date", async () => {
    global.fetch = makeMockFetch({
      "anthropic.claude-opus-4-6-v1": {
        max_input_tokens: 1_000_000,
        max_output_tokens: 128_000,
        mode: "chat",
      },
    });

    const registry = new ModelRegistry({ ttlMs: 60_000 });
    // Query base name (without -v1)
    const result = await registry.resolve("anthropic.claude-opus-4-6");
    expect(result).toBeDefined();
    expect(result?.contextWindowSize).toBe(1_000_000);
    expect(result?.maxOutputTokens).toBe(128_000);
  });

  test("exact match takes priority over version fallback", async () => {
    global.fetch = makeMockFetch({
      // Versioned entry with specific limits
      "anthropic.claude-3-5-sonnet-20241022-v2:0": {
        max_input_tokens: 1_000_000,
        max_output_tokens: 8192,
        mode: "chat",
      },
      // Older version with different limits
      "anthropic.claude-3-5-sonnet-20240620-v1:0": {
        max_input_tokens: 1_000_000,
        max_output_tokens: 4096,
        mode: "chat",
      },
    });

    const registry = new ModelRegistry({ ttlMs: 60_000 });
    // Exact match should return the specific entry
    const exact = await registry.resolve("anthropic.claude-3-5-sonnet-20241022-v2:0");
    expect(exact?.maxOutputTokens).toBe(8192);

    const older = await registry.resolve("anthropic.claude-3-5-sonnet-20240620-v1:0");
    expect(older?.maxOutputTokens).toBe(4096);
  });

  test("version fallback works with regional prefix", async () => {
    global.fetch = makeMockFetch({
      "anthropic.claude-sonnet-4-6": {
        max_input_tokens: 200_000,
        max_output_tokens: 64_000,
        mode: "chat",
      },
    });

    const registry = new ModelRegistry({ ttlMs: 60_000 });
    // Regional prefix + versioned ID
    const result = await registry.resolve("us.anthropic.claude-sonnet-4-6-20260315-v1:0");
    expect(result).toBeDefined();
    expect(result?.contextWindowSize).toBe(200_000);
  });

  test("resolveSync also uses version fallback", async () => {
    global.fetch = makeMockFetch({
      "anthropic.claude-sonnet-4-6": {
        max_input_tokens: 200_000,
        max_output_tokens: 64_000,
        mode: "chat",
      },
    });

    const registry = new ModelRegistry({ ttlMs: 60_000 });
    // Populate cache
    await registry.resolve("anthropic.claude-sonnet-4-6");

    // resolveSync with versioned query
    const result = registry.resolveSync("anthropic.claude-sonnet-4-6-20260315-v1:0");
    expect(result).toBeDefined();
    expect(result?.maxOutputTokens).toBe(64_000);
  });
});
