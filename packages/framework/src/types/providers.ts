// =============================================================================
// @obsku/framework — Provider interface definitions
// =============================================================================

import type { ChatOptions, LLMResponse, LLMStreamEvent, Message, ToolDef } from "./llm";

// --- Provider Interfaces ---

/** LLM provider interface. Implement `chat` and `chatStream` to plug in any model backend. */
export interface LLMProvider {
  /** Send messages and get a complete response (non-streaming). */
  chat(
    messages: Array<Message>,
    tools?: Array<ToolDef>,
    options?: ChatOptions
  ): Promise<LLMResponse>;
  /**
   * Stream chat completions as an async iterable of events.
   * Yields LLMStreamEvent objects (text deltas, tool calls, stop signals) as they arrive.
   * @param messages - Conversation history to send.
   * @param tools - Tool definitions available to the model.
   * @returns Async iterable of streaming events.
   */
  chatStream(messages: Array<Message>, tools?: Array<ToolDef>): AsyncIterable<LLMStreamEvent>;
  /** Provider's native context window size (max input tokens). */
  readonly contextWindowSize: number;
  /** Provider's maximum output tokens. Optional — not all providers expose this. */
  readonly maxOutputTokens?: number;
}

/** MCP protocol tool call result (CallToolResult shape). */
export interface McpCallToolResult {
  _meta?: Record<string, unknown>;
  content: Array<
    | { annotations?: Record<string, unknown>; text: string; type: "text" }
    | { annotations?: Record<string, unknown>; data: string; mimeType: string; type: "image" }
    | { annotations?: Record<string, unknown>; resource: Record<string, unknown>; type: "resource" }
  >;
  isError?: boolean;
}

export interface McpProvider {
  callTool(name: string, input: Record<string, unknown>): Promise<McpCallToolResult>;
  close(): Promise<void>;
  connect(): Promise<void>;
  listTools(): Promise<Array<ToolDef>>;
}
