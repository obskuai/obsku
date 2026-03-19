export const MessageRole = {
  ASSISTANT: "assistant",
  SYSTEM: "system",
  TOOL: "tool",
  USER: "user",
} as const;

export const BlockType = {
  IMAGE: "image",
  TEXT: "text",
  THINKING: "thinking",
  TOOL_RESULT: "tool_result",
  TOOL_USE: "tool_use",
} as const;
