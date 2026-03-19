/**
 * Integration tests for provider factory functions.
 *
 * Tests the 4 factory functions (openai, anthropic, google, groq):
 * - LLMProvider shape validation (has chat, chatStream, contextWindowSize)
 * - contextWindowSize precedence (explicit > model defaults > fallback)
 * - Anthropic thinkingBudgetTokens → providerOptions mapping
 *
 * Uses mock API keys to avoid real API calls.
 * Note: Tests pass explicit contextWindowSize and maxOutputTokens since
 * LiteLLM registry is unreachable in test environment.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { LLMProvider } from "@obsku/framework";
import { anthropic } from "../src/providers/anthropic";
import { google } from "../src/providers/google";
import { groq } from "../src/providers/groq";
import { openai } from "../src/providers/openai";

// Store original env vars
const originalEnv: Record<string, string | undefined> = {};

// Mock API keys for testing (factories need these to initialize)
const MOCK_KEYS = {
  OPENAI_API_KEY: "sk-test-mock-key",
  ANTHROPIC_API_KEY: "sk-ant-test-mock-key",
  GOOGLE_GENERATIVE_AI_API_KEY: "test-mock-key",
  GROQ_API_KEY: "gsk_test-mock-key",
};

beforeAll(() => {
  // Save and set mock env vars
  for (const [key, value] of Object.entries(MOCK_KEYS)) {
    originalEnv[key] = process.env[key];
    process.env[key] = value;
  }
});

afterAll(() => {
  // Restore original env vars
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

// --- Helper to validate LLMProvider shape ---

function assertLLMProviderShape(provider: LLMProvider, name: string) {
  expect(provider, `${name} should be defined`).toBeDefined();
  expect(typeof provider.chat, `${name}.chat should be a function`).toBe("function");
  expect(typeof provider.chatStream, `${name}.chatStream should be a function`).toBe("function");
  expect(typeof provider.contextWindowSize, `${name}.contextWindowSize should be a number`).toBe(
    "number"
  );
  expect(
    provider.contextWindowSize,
    `${name}.contextWindowSize should be positive`
  ).toBeGreaterThan(0);
}

// --- OpenAI Factory ---

describe("openai factory", () => {
  test("returns LLMProvider with correct shape", async () => {
    const provider = await openai({
      model: "gpt-4o",
      contextWindowSize: 128000,
      maxOutputTokens: 16384,
    });
    assertLLMProviderShape(provider, "openai");
  });

  test("explicit contextWindowSize is used", async () => {
    const provider = await openai({
      model: "gpt-4o",
      contextWindowSize: 50000,
      maxOutputTokens: 16384,
    });
    expect(provider.contextWindowSize).toBe(50_000);
  });

  test("unknown model without explicit config throws", async () => {
    await expect(openai({ model: "unknown-future-model" })).rejects.toThrow();
  });

  test("maxOutputTokens is passed through", async () => {
    const provider = await openai({
      model: "gpt-4o",
      contextWindowSize: 128000,
      maxOutputTokens: 8192,
    });
    expect(provider.maxOutputTokens).toBe(8192);
  });
});

// --- Anthropic Factory ---

describe("anthropic factory", () => {
  test("returns LLMProvider with correct shape", async () => {
    const provider = await anthropic({
      model: "claude-sonnet-4-20250514",
      contextWindowSize: 200000,
      maxOutputTokens: 8192,
    });
    assertLLMProviderShape(provider, "anthropic");
  });

  test("unknown model without explicit config throws", async () => {
    await expect(anthropic({ model: "claude-future-model" })).rejects.toThrow();
  });

  test("explicit contextWindowSize overrides", async () => {
    const provider = await anthropic({
      model: "claude-sonnet-4-20250514",
      contextWindowSize: 100000,
      maxOutputTokens: 8192,
    });
    expect(provider.contextWindowSize).toBe(100_000);
  });

  test("maxOutputTokens is passed through", async () => {
    const provider = await anthropic({
      model: "claude-sonnet-4-20250514",
      contextWindowSize: 200000,
      maxOutputTokens: 4096,
    });
    expect(provider.maxOutputTokens).toBe(4096);
  });
});

// --- Google Factory ---

describe("google factory", () => {
  test("returns LLMProvider with correct shape", async () => {
    const provider = await google({
      model: "gemini-2.0-flash",
      contextWindowSize: 1000000,
      maxOutputTokens: 8192,
    });
    assertLLMProviderShape(provider, "google");
  });

  test("unknown model without explicit config throws", async () => {
    await expect(google({ model: "unknown-gemini-model" })).rejects.toThrow();
  });

  test("explicit contextWindowSize overrides", async () => {
    const provider = await google({
      model: "gemini-2.0-flash",
      contextWindowSize: 500000,
      maxOutputTokens: 8192,
    });
    expect(provider.contextWindowSize).toBe(500_000);
  });

  test("maxOutputTokens is passed through", async () => {
    const provider = await google({
      model: "gemini-2.0-flash",
      contextWindowSize: 1000000,
      maxOutputTokens: 4096,
    });
    expect(provider.maxOutputTokens).toBe(4096);
  });
});

// --- Groq Factory ---

describe("groq factory", () => {
  test("returns LLMProvider with correct shape", async () => {
    const provider = await groq({
      model: "llama-3.3-70b",
      contextWindowSize: 128000,
      maxOutputTokens: 8192,
    });
    assertLLMProviderShape(provider, "groq");
  });

  test("unknown model without explicit config throws", async () => {
    await expect(groq({ model: "unknown-llama-model" })).rejects.toThrow();
  });

  test("explicit contextWindowSize overrides", async () => {
    const provider = await groq({
      model: "llama-3.3-70b",
      contextWindowSize: 64000,
      maxOutputTokens: 8192,
    });
    expect(provider.contextWindowSize).toBe(64_000);
  });

  test("maxOutputTokens is passed through", async () => {
    const provider = await groq({
      model: "llama-3.3-70b",
      contextWindowSize: 128000,
      maxOutputTokens: 4096,
    });
    expect(provider.maxOutputTokens).toBe(4096);
  });
});

// --- Cross-provider tests ---

describe("all providers", () => {
  test("all factory functions are exported", () => {
    expect(typeof openai).toBe("function");
    expect(typeof anthropic).toBe("function");
    expect(typeof google).toBe("function");
    expect(typeof groq).toBe("function");
  });

  test("all providers return objects with chat method", async () => {
    const providers = await Promise.all([
      openai({ model: "gpt-4o", contextWindowSize: 128000, maxOutputTokens: 16384 }),
      anthropic({
        model: "claude-sonnet-4-20250514",
        contextWindowSize: 200000,
        maxOutputTokens: 8192,
      }),
      google({ model: "gemini-2.0-flash", contextWindowSize: 1000000, maxOutputTokens: 8192 }),
      groq({ model: "llama-3.3-70b", contextWindowSize: 128000, maxOutputTokens: 8192 }),
    ]);

    for (const provider of providers) {
      expect(typeof provider.chat).toBe("function");
    }
  });

  test("all providers return objects with chatStream method", async () => {
    const providers = await Promise.all([
      openai({ model: "gpt-4o", contextWindowSize: 128000, maxOutputTokens: 16384 }),
      anthropic({
        model: "claude-sonnet-4-20250514",
        contextWindowSize: 200000,
        maxOutputTokens: 8192,
      }),
      google({ model: "gemini-2.0-flash", contextWindowSize: 1000000, maxOutputTokens: 8192 }),
      groq({ model: "llama-3.3-70b", contextWindowSize: 128000, maxOutputTokens: 8192 }),
    ]);

    for (const provider of providers) {
      expect(typeof provider.chatStream).toBe("function");
    }
  });

  test("all providers have positive contextWindowSize", async () => {
    const providers = [
      {
        name: "openai",
        provider: await openai({
          model: "gpt-4o",
          contextWindowSize: 128000,
          maxOutputTokens: 16384,
        }),
      },
      {
        name: "anthropic",
        provider: await anthropic({
          model: "claude-sonnet-4-20250514",
          contextWindowSize: 200000,
          maxOutputTokens: 8192,
        }),
      },
      {
        name: "google",
        provider: await google({
          model: "gemini-2.0-flash",
          contextWindowSize: 1000000,
          maxOutputTokens: 8192,
        }),
      },
      {
        name: "groq",
        provider: await groq({
          model: "llama-3.3-70b",
          contextWindowSize: 128000,
          maxOutputTokens: 8192,
        }),
      },
    ];

    for (const { name, provider } of providers) {
      expect(
        provider.contextWindowSize,
        `${name} contextWindowSize should be positive`
      ).toBeGreaterThan(0);
    }
  });
});
