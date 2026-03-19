// =============================================================================
// @obsku/framework — LLM type definitions (foundation layer)
// =============================================================================

// --- Content Blocks (LLM message primitives) ---

export type TextContent = { text: string; type: "text" };

export type ToolUseContent = {
  input: Record<string, unknown>;
  name: string;
  toolUseId: string;
  type: "tool_use";
};

export type ToolResultContent = {
  content: string;
  fullOutputRef?: string;
  status?: "success" | "error";
  toolUseId: string;
  type: "tool_result";
};

export type ContentBlock = TextContent | ToolUseContent | ToolResultContent;

// --- LLM Types ---

export interface Message {
  content: Array<ContentBlock>;
  role: "user" | "assistant" | "system";
}

export interface ToolDef {
  description: string;
  inputSchema: {
    properties: Record<string, unknown>;
    required?: Array<string>;
    type: "object";
  };
  name: string;
}

export interface ToolCall {
  input: Record<string, unknown>;
  name: string;
  toolUseId: string;
}

export interface LLMResponse {
  content: Array<ContentBlock>;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  usage: { inputTokens: number; outputTokens: number };
}

export type LLMStreamEvent =
  | { readonly content: string; readonly type: "text_delta" }
  | { readonly name: string; readonly toolUseId: string; readonly type: "tool_use_start" }
  | { readonly input: string; readonly type: "tool_use_delta" }
  | { readonly type: "tool_use_end" }
  | {
      readonly stopReason: string;
      readonly type: "message_end";
      readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
    };

// --- Structured Output Types ---

import type { JsonSchema } from "./json-schema";

export interface ResponseFormat {
  jsonSchema: {
    description?: string;
    name?: string;
    schema: JsonSchema;
  };
  type: "json_schema";
}

export interface ChatOptions {
  responseFormat?: ResponseFormat;
}
