import type {
  ChatOptions,
  LLMProvider,
  LLMResponse,
  LLMStreamEvent,
  Message,
  ToolDef,
} from "../../src/types";

// ---------------------------------------------------------------------------
// Recorded calls for test assertions
// ---------------------------------------------------------------------------

export interface RecordedCall {
  messages: Array<Message>;
  options?: ChatOptions;
  tools?: Array<ToolDef>;
}

// Global recording storage (per-test isolation recommended)
export const recordedCalls: Array<RecordedCall> = [];

/**
 * Clear all recorded calls. Call this in test setup.
 */
export function clearRecordedCalls(): void {
  recordedCalls.length = 0;
}

/**
 * Get all recorded calls for assertions.
 */
export function getRecordedCalls(): ReadonlyArray<RecordedCall> {
  return [...recordedCalls];
}

// ---------------------------------------------------------------------------
// MockLLMProvider — Promise-based mock implementing LLMProvider interface
// ---------------------------------------------------------------------------

function mockResponse(messages: Array<Message>, tools?: Array<ToolDef>): LLMResponse {
  const lastMessage = messages.at(-1);
  const hasToolResult = lastMessage?.content.some((c) => c.type === "tool_result");

  if (hasToolResult) {
    return {
      content: [
        {
          text: "Based on the tool results, the scan reveals open ports on the target.",
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 150, outputTokens: 30 },
    };
  }

  if (tools && tools.length > 0) {
    const tool = tools[0];
    return {
      content: [
        {
          input: Object.fromEntries(
            (tool.inputSchema.required ?? []).map((k) => [k, "mock_value"])
          ),
          name: tool.name,
          toolUseId: `mock_tool_${Date.now()}`,
          type: "tool_use",
        },
      ],
      stopReason: "tool_use",
      usage: { inputTokens: 100, outputTokens: 50 },
    };
  }

  return {
    content: [{ text: "Mock response to your message.", type: "text" }],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 8 },
  };
}

async function* mockStreamResponse(
  _messages: Array<Message>,
  tools?: Array<ToolDef>
): AsyncIterable<LLMStreamEvent> {
  if (tools && tools.length > 0) {
    const tool = tools[0];
    const toolUseId = `mock_tool_${Date.now()}`;
    const inputJson = JSON.stringify(
      Object.fromEntries((tool.inputSchema.required ?? []).map((k) => [k, "mock_value"]))
    );
    yield { name: tool.name, toolUseId, type: "tool_use_start" };
    yield { input: inputJson, type: "tool_use_delta" };
    yield { type: "tool_use_end" };
    yield {
      stopReason: "tool_use",
      type: "message_end",
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    return;
  }

  yield { content: "Mock ", type: "text_delta" };
  yield { content: "response ", type: "text_delta" };
  yield { content: "to your message.", type: "text_delta" };
  yield {
    stopReason: "end_turn",
    type: "message_end",
    usage: { inputTokens: 10, outputTokens: 8 },
  };
}

/**
 * Creates a mock LLM provider for testing.
 * Returns LLMProvider with deterministic behavior:
 * - With tools: returns tool_use for the first tool
 * - With tool_result in last message: returns text summary
 * - Otherwise: returns simple text response
 *
 * Now accepts optional ChatOptions parameter to support structured output testing.
 */
export function mockLLMProvider(): LLMProvider {
  return {
    async chat(
      messages: Array<Message>,
      tools?: Array<ToolDef>,
      options?: ChatOptions
    ): Promise<LLMResponse> {
      // Record the call for test assertions
      recordedCalls.push({ messages, options, tools });
      return mockResponse(messages, tools);
    },
    chatStream(messages: Array<Message>, tools?: Array<ToolDef>): AsyncIterable<LLMStreamEvent> {
      return mockStreamResponse(messages, tools);
    },
    contextWindowSize: 200_000,
  };
}

// ---------------------------------------------------------------------------
// Structured Output Mock Helpers
// ---------------------------------------------------------------------------

/**
 * Configuration for creating a mock provider with structured output support.
 */
export interface MockStructuredOutputConfig {
  /** Custom response for subsequent calls after failure */
  readonly fallbackResponse?: string;
  /** Schema-compliant JSON to return when responseFormat is provided */
  readonly response: Record<string, unknown>;
  /** If true, throws ValidationException on first call (to test fallback) */
  readonly shouldFailFirst?: boolean;
}

/**
 * Creates a mock provider that returns schema-compliant JSON for structured output testing.
 *
 * When `responseFormat` is provided in options, returns the configured JSON response.
 * Supports testing both native structured output path and fallback path.
 *
 * @example
 * ```typescript
 * // Native path test
 * const provider = createMockProviderWithStructuredOutput({
 *   response: { name: "Alice", score: 95 }
 * });
 *
 * // Fallback path test
 * const provider = createMockProviderWithStructuredOutput({
 *   response: { name: "Alice", score: 95 },
 *   shouldFailFirst: true,
 *   fallbackResponse: '{"name": "Alice", "score": 95}'
 * });
 * ```
 */
export function createMockProviderWithStructuredOutput(
  config: MockStructuredOutputConfig
): LLMProvider {
  let callCount = 0;
  let hasFailed = false;

  return {
    async chat(
      messages: Array<Message>,
      tools?: Array<ToolDef>,
      options?: ChatOptions
    ): Promise<LLMResponse> {
      callCount++;

      // Record the call
      recordedCalls.push({ messages, options, tools });

      // Check if this is a structured output call (responseFormat provided)
      const isStructuredCall = options?.responseFormat !== undefined;

      // Simulate ValidationException on first call if configured
      if (config.shouldFailFirst && !hasFailed) {
        hasFailed = true;
        // Throw an error that mimics provider-native ValidationException
        const error = new Error("ValidationException: Output does not match the provided schema");
        (error as Error & { _tag: string })._tag = "ValidationException";
        throw error;
      }

      // Return structured JSON if responseFormat is provided
      if (isStructuredCall) {
        // If we have a fallback response after a failure, use it
        if (hasFailed && config.fallbackResponse) {
          return {
            content: [{ text: config.fallbackResponse, type: "text" }],
            stopReason: "end_turn",
            usage: { inputTokens: 50, outputTokens: 25 },
          };
        }

        // Return the configured schema-compliant response
        return {
          content: [{ text: JSON.stringify(config.response), type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 50, outputTokens: 25 },
        };
      }

      // Default behavior for non-structured calls
      return mockResponse(messages, tools);
    },
    chatStream(messages: Array<Message>, tools?: Array<ToolDef>): AsyncIterable<LLMStreamEvent> {
      return mockStreamResponse(messages, tools);
    },
    contextWindowSize: 200_000,
  };
}
