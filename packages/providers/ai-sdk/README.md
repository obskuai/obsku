# @obsku/provider-ai-sdk

[Vercel AI SDK](https://sdk.vercel.ai/) provider adapter for @obsku/framework. Use any AI SDK-compatible model as an obsku LLMProvider.

## Installation

```bash
npm install @obsku/provider-ai-sdk
```

## Quick Start

### Provider Factories (Recommended)

```typescript
import { agent } from "@obsku/framework";
import { openai, anthropic, google, groq } from "@obsku/provider-ai-sdk";

// OpenAI
const provider = openai({ model: "gpt-4o" });

// Anthropic
const provider = anthropic({ model: "claude-sonnet-4-20250514" });

// Anthropic with Extended Thinking
const provider = anthropic({
  model: "claude-opus-4",
  thinkingBudgetTokens: 10000,
});

// Google
const provider = google({ model: "gemini-2.0-flash" });

// Groq
const provider = groq({ model: "llama-3.3-70b" });

const assistant = agent({
  name: "assistant",
  prompt: "You are a helpful assistant.",
});

const result = await assistant.run("Hello!", provider);
```

### Generic Adapter

Use `fromAiSdk()` to wrap any `LanguageModelV1`:

```typescript
import { fromAiSdk } from "@obsku/provider-ai-sdk";
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({ apiKey: "..." });
const provider = fromAiSdk(openai("gpt-4o"), {
  contextWindowSize: 128000,
  maxOutputTokens: 16384,
});
```

## API Reference

### Factories

| Function | Config | Description |
|----------|--------|-------------|
| `openai(config)` | `BaseProviderConfig` | OpenAI models via `@ai-sdk/openai` |
| `anthropic(config)` | `AnthropicProviderConfig` | Anthropic models with optional Extended Thinking |
| `google(config)` | `BaseProviderConfig` | Google Gemini models via `@ai-sdk/google` |
| `groq(config)` | `BaseProviderConfig` | Groq models via `@ai-sdk/groq` |

### `fromAiSdk(model, config?)`

Wraps any AI SDK `LanguageModelV1` as an obsku `LLMProvider`.

### Config Types

```typescript
interface BaseProviderConfig {
  model: string;
  contextWindowSize?: number;
  maxOutputTokens?: number;
}

interface AnthropicProviderConfig extends BaseProviderConfig {
  thinkingBudgetTokens?: number;  // Enables Extended Thinking
}

interface AdapterConfig {
  contextWindowSize?: number;     // Default: auto-resolved from model registry
  maxOutputTokens?: number;
  providerOptions?: Record<string, unknown>;
}
```

### Model Resolution

Context window sizes and max output tokens are resolved via the framework's `ModelRegistry` (LiteLLM-backed). Pass explicit values to override:

```typescript
const provider = await openai({
  model: "gpt-4o",
  contextWindowSize: 128000,
  maxOutputTokens: 16384,
});
```

## Environment Variables

API keys are managed by the AI SDK packages:

- `OPENAI_API_KEY` — OpenAI
- `ANTHROPIC_API_KEY` — Anthropic
- `GOOGLE_GENERATIVE_AI_API_KEY` — Google
- `GROQ_API_KEY` — Groq

## License

MIT
