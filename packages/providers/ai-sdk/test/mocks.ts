/**
 * Mock helpers for AI SDK adapter tests.
 *
 * Provides utilities to create mock LanguageModelV1 instances,
 * generateText results, and stream results for testing.
 */

import type { LanguageModelV1 } from "ai";

// --- Types ---

export interface MockGenerateOptions {
  /** Text content to return */
  text?: string;
  /** Tool calls to include in response */
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }>;
  /** Finish reason: "stop" | "length" | "tool-calls" | etc */
  finishReason?: string;
  /** Token usage */
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  /** If set, throws this error when doGenerate is called */
  error?: Error;
}

export interface MockStreamPart {
  type:
    | "text-delta"
    | "tool-call"
    | "tool-call-streaming-start"
    | "tool-call-delta"
    | "finish"
    | "error";
  textDelta?: string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  argsTextDelta?: string;
  finishReason?: string;
  usage?: { promptTokens: number; completionTokens: number };
  error?: unknown;
}

export interface MockStreamOptions {
  /** Stream parts to yield */
  parts?: MockStreamPart[];
  /** If set, throws this error when doStream is called */
  error?: Error;
}

export interface MockModelConfig {
  /** Model identifier */
  modelId?: string;
  /** Provider name */
  provider?: string;
  /** Default context window size (if model supports it) */
  defaultContextWindowSize?: number;
  /** Options for doGenerate behavior */
  generate?: MockGenerateOptions;
  /** Options for doStream behavior */
  stream?: MockStreamOptions;
}

// --- Mock Creators ---

/**
 * Creates a mock LanguageModelV1 instance for testing.
 *
 * @example
 * ```typescript
 * const model = createMockLanguageModel({
 *   generate: { text: "Hello!", finishReason: "stop" }
 * });
 *
 * const provider = fromAiSdk(model);
 * const response = await provider.chat([{ role: "user", content: [{ type: "text", text: "Hi" }] }]);
 * ```
 */
export function createMockLanguageModel(config: MockModelConfig = {}): LanguageModelV1 {
  const { modelId = "mock-model", provider = "mock", generate = {}, stream = {} } = config;

  const generateConfig: MockGenerateOptions = {
    text: generate.text ?? "",
    toolCalls: generate.toolCalls ?? [],
    finishReason: generate.finishReason ?? "stop",
    usage: generate.usage ?? { promptTokens: 10, completionTokens: 20 },
    error: generate.error,
  };

  const streamConfig: MockStreamOptions = {
    parts: stream.parts ?? [],
    error: stream.error,
  };

  return {
    specificationVersion: "v1" as const,
    provider,
    modelId,

    async doGenerate(_options) {
      if (generateConfig.error) {
        throw generateConfig.error;
      }

      return {
        text: generateConfig.text,
        toolCalls: generateConfig.toolCalls?.map((tc) => ({
          type: "tool-call" as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.args,
        })),
        finishReason: generateConfig.finishReason,
        usage: generateConfig.usage,
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },

    async doStream(_options) {
      if (streamConfig.error) {
        throw streamConfig.error;
      }

      // Create an async generator for the stream
      async function* generateStream() {
        for (const part of streamConfig.parts ?? []) {
          yield part as unknown;
        }
      }

      return {
        stream: generateStream(),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  } as LanguageModelV1;
}

/**
 * Creates mock stream parts for a text response.
 */
export function createTextStreamParts(
  text: string,
  usage?: { promptTokens: number; completionTokens: number }
): MockStreamPart[] {
  return [
    { type: "text-delta", textDelta: text },
    {
      type: "finish",
      finishReason: "stop",
      usage: usage ?? { promptTokens: 10, completionTokens: 20 },
    },
  ];
}

/**
 * Creates mock stream parts for a tool call response.
 */
export function createToolCallStreamParts(
  toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>,
  usage?: { promptTokens: number; completionTokens: number }
): MockStreamPart[] {
  const parts: MockStreamPart[] = [];

  for (const tc of toolCalls) {
    parts.push({
      type: "tool-call-streaming-start",
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
    });
    parts.push({
      type: "tool-call-delta",
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      argsTextDelta: JSON.stringify(tc.args),
    });
    parts.push({
      type: "tool-call",
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      args: tc.args,
    });
  }

  parts.push({
    type: "finish",
    finishReason: "tool-calls",
    usage: usage ?? { promptTokens: 10, completionTokens: 50 },
  });

  return parts;
}

/**
 * Creates mock stream parts for an error response.
 */
export function createErrorStreamParts(error: unknown): MockStreamPart[] {
  return [{ type: "error", error }];
}

// --- Test Fixtures ---

/**
 * Creates a simple user message for testing.
 */
export function createUserMessage(text: string) {
  return {
    role: "user" as const,
    content: [{ type: "text" as const, text }],
  };
}

/**
 * Creates a simple system message for testing.
 */
export function createSystemMessage(text: string) {
  return {
    role: "system" as const,
    content: [{ type: "text" as const, text }],
  };
}

/**
 * Creates a simple tool definition for testing.
 */
export function createTestTool(name: string = "test_tool", description: string = "A test tool") {
  return {
    name,
    description,
    inputSchema: {
      type: "object" as const,
      properties: {
        input: { type: "string" as const },
      },
    },
  };
}
