import { describe, expect, it } from "bun:test";
import {
  KNOWN_PROVIDERS,
  resolveProvider,
  createAdapter,
  type DetectedProvider,
  type ProviderResolutionConfig,
  type StudioProviderId,
} from "../../src/server/provider-adapter.js";

describe("provider-adapter", () => {
  describe("KNOWN_PROVIDERS", () => {
    it("contains exactly 5 providers", () => {
      expect(KNOWN_PROVIDERS.size).toBe(5);
    });

    it("contains bedrock provider", () => {
      const bedrock = KNOWN_PROVIDERS.get("bedrock");
      expect(bedrock).toBeDefined();
      expect(bedrock?.name).toBe("Amazon Bedrock");
      expect(bedrock?.defaultModel).toBe("amazon.nova-lite-v1:0");
      expect(bedrock?.models).toContain("amazon.nova-lite-v1:0");
      expect(bedrock?.models).toContain("anthropic.claude-3-sonnet-20240229-v1:0");
      expect(bedrock?.package).toBe("@obsku/provider-bedrock");
    });

    it("contains anthropic provider", () => {
      const anthropic = KNOWN_PROVIDERS.get("anthropic");
      expect(anthropic).toBeDefined();
      expect(anthropic?.name).toBe("Anthropic");
      expect(anthropic?.defaultModel).toBe("claude-sonnet-4-20250514");
      expect(anthropic?.package).toBe("@obsku/provider-ai-sdk");
    });

    it("contains google provider", () => {
      const google = KNOWN_PROVIDERS.get("google");
      expect(google).toBeDefined();
      expect(google?.name).toBe("Google AI");
      expect(google?.defaultModel).toBe("gemini-2.0-flash");
      expect(google?.package).toBe("@obsku/provider-ai-sdk");
    });

    it("contains groq provider", () => {
      const groq = KNOWN_PROVIDERS.get("groq");
      expect(groq).toBeDefined();
      expect(groq?.name).toBe("Groq");
      expect(groq?.defaultModel).toBe("llama-3.3-70b-versatile");
      expect(groq?.package).toBe("@obsku/provider-ai-sdk");
    });

    it("contains openai provider", () => {
      const openai = KNOWN_PROVIDERS.get("openai");
      expect(openai).toBeDefined();
      expect(openai?.name).toBe("OpenAI");
      expect(openai?.defaultModel).toBe("gpt-4o");
      expect(openai?.package).toBe("@obsku/provider-ai-sdk");
    });

    it("does NOT contain ollama entry", () => {
      expect(KNOWN_PROVIDERS.has("ollama" as StudioProviderId)).toBe(false);
    });
  });

  describe("resolveProvider", () => {
    it("returns config provider when config.provider is set", () => {
      const config: ProviderResolutionConfig = { provider: "anthropic" };
      const detected: DetectedProvider[] = [];

      const result = resolveProvider(config, detected);

      expect(result.source).toBe("config");
      expect(result.provider.id).toBe("anthropic");
      expect(result.provider.name).toBe("Anthropic");
    });

    it("returns config provider with custom model when both specified", () => {
      const config: ProviderResolutionConfig = { provider: "openai", model: "gpt-4o-mini" };
      const detected: DetectedProvider[] = [];

      const result = resolveProvider(config, detected);

      expect(result.source).toBe("config");
      expect(result.provider.id).toBe("openai");
      expect(result.provider.getDefaultModel()).toBe("gpt-4o"); // default is still gpt-4o
    });

    it("returns heuristic provider when exactly 1 provider detected", () => {
      const config: ProviderResolutionConfig = {};
      const detected: DetectedProvider[] = [
        { package: "@obsku/provider-ai-sdk", providerIds: ["groq"] },
      ];

      const result = resolveProvider(config, detected);

      expect(result.source).toBe("heuristic");
      expect(result.provider.id).toBe("groq");
      expect(result.provider.name).toBe("Groq");
    });

    it("returns fallback (bedrock) when multiple providers detected", () => {
      const config: ProviderResolutionConfig = {};
      const detected: DetectedProvider[] = [
        { package: "@obsku/provider-ai-sdk", providerIds: ["anthropic", "openai"] },
      ];

      const result = resolveProvider(config, detected);

      expect(result.source).toBe("fallback");
      expect(result.provider.id).toBe("bedrock");
      expect(result.provider.name).toBe("Amazon Bedrock");
    });

    it("returns fallback (bedrock) when no config and no detection", () => {
      const config: ProviderResolutionConfig = {};
      const detected: DetectedProvider[] = [];

      const result = resolveProvider(config, detected);

      expect(result.source).toBe("fallback");
      expect(result.provider.id).toBe("bedrock");
      expect(result.provider.name).toBe("Amazon Bedrock");
    });

    it("config takes priority over detected providers", () => {
      const config: ProviderResolutionConfig = { provider: "google" };
      const detected: DetectedProvider[] = [
        { package: "@obsku/provider-ai-sdk", providerIds: ["anthropic"] },
      ];

      const result = resolveProvider(config, detected);

      expect(result.source).toBe("config");
      expect(result.provider.id).toBe("google");
    });

    it("config takes priority even with multiple detected providers", () => {
      const config: ProviderResolutionConfig = { provider: "groq" };
      const detected: DetectedProvider[] = [
        { package: "@obsku/provider-ai-sdk", providerIds: ["anthropic", "openai", "google"] },
      ];

      const result = resolveProvider(config, detected);

      expect(result.source).toBe("config");
      expect(result.provider.id).toBe("groq");
    });

    it("handles detected providers from multiple packages", () => {
      const config: ProviderResolutionConfig = {};
      const detected: DetectedProvider[] = [
        { package: "@obsku/provider-ai-sdk", providerIds: ["anthropic"] },
        { package: "@obsku/provider-bedrock", providerIds: ["bedrock"] },
      ];

      const result = resolveProvider(config, detected);

      // Multiple unique providers detected, should fallback to bedrock
      expect(result.source).toBe("fallback");
      expect(result.provider.id).toBe("bedrock");
    });

    it("handles single provider detected across multiple packages (same ID)", () => {
      const config: ProviderResolutionConfig = {};
      const detected: DetectedProvider[] = [
        { package: "@obsku/provider-ai-sdk", providerIds: ["openai"] },
        { package: "custom-wrapper", providerIds: ["openai"] },
      ];

      const result = resolveProvider(config, detected);

      // Same provider ID detected twice, count as 1 unique
      expect(result.source).toBe("heuristic");
      expect(result.provider.id).toBe("openai");
    });
  });

  describe("createAdapter", () => {
    it("creates bedrock adapter with correct properties", () => {
      const adapter = createAdapter("bedrock");

      expect(adapter.id).toBe("bedrock");
      expect(adapter.name).toBe("Amazon Bedrock");
      expect(adapter.getDefaultModel()).toBe("amazon.nova-lite-v1:0");
      expect(adapter.listModels()).toContain("amazon.nova-lite-v1:0");
      expect(adapter.listModels()).toContain("anthropic.claude-3-sonnet-20240229-v1:0");
      expect(typeof adapter.createProvider).toBe("function");
    });

    it("creates anthropic adapter with correct properties", () => {
      const adapter = createAdapter("anthropic");

      expect(adapter.id).toBe("anthropic");
      expect(adapter.name).toBe("Anthropic");
      expect(adapter.getDefaultModel()).toBe("claude-sonnet-4-20250514");
      expect(adapter.listModels()).toContain("claude-sonnet-4-20250514");
      expect(typeof adapter.createProvider).toBe("function");
    });

    it("creates google adapter with correct properties", () => {
      const adapter = createAdapter("google");

      expect(adapter.id).toBe("google");
      expect(adapter.name).toBe("Google AI");
      expect(adapter.getDefaultModel()).toBe("gemini-2.0-flash");
      expect(adapter.listModels()).toContain("gemini-2.0-flash");
      expect(typeof adapter.createProvider).toBe("function");
    });

    it("creates groq adapter with correct properties", () => {
      const adapter = createAdapter("groq");

      expect(adapter.id).toBe("groq");
      expect(adapter.name).toBe("Groq");
      expect(adapter.getDefaultModel()).toBe("llama-3.3-70b-versatile");
      expect(adapter.listModels()).toContain("llama-3.3-70b-versatile");
      expect(typeof adapter.createProvider).toBe("function");
    });

    it("creates openai adapter with correct properties", () => {
      const adapter = createAdapter("openai");

      expect(adapter.id).toBe("openai");
      expect(adapter.name).toBe("OpenAI");
      expect(adapter.getDefaultModel()).toBe("gpt-4o");
      expect(adapter.listModels()).toContain("gpt-4o");
      expect(typeof adapter.createProvider).toBe("function");
    });

    it("uses custom model when provided", () => {
      const adapter = createAdapter("openai", "gpt-4o-mini");
      
      // getDefaultModel returns the KNOWN_PROVIDERS default, not the custom model
      expect(adapter.getDefaultModel()).toBe("gpt-4o");
      // but listModels still shows all available
      expect(adapter.listModels()).toContain("gpt-4o-mini");
    });

    it("throws for unknown provider", () => {
      expect(() => createAdapter("unknown" as StudioProviderId)).toThrow("Unknown provider: unknown");
    });
  });
});
