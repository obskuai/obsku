// AI SDK provider adapter

// Core adapter
export { fromAiSdk, type AdapterConfig } from "./adapter";

// Provider factories
export { anthropic, google, groq, openai } from "./providers";

// Errors
export { mapAiSdkError, AiSdkError } from "./errors";

// Converters (for advanced usage)
export { toAiSdkMessages, toAiSdkTools, fromAiSdkResponse } from "./converter";

// Stream mapping (for advanced usage)
export { mapStreamEvents } from "./stream-mapper";

// Types
export type { BaseProviderConfig, AnthropicProviderConfig } from "./providers/types";
