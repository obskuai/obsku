import type { LLMProvider, LLMResponse, LLMStreamEvent, Message, ToolDef } from "./types";

export interface ProviderHooks {
  afterChat?: (response: LLMResponse) => void | Promise<void>;
  beforeChat?: (messages: Array<Message>, tools?: Array<ToolDef>) => void | Promise<void>;
}

export function wrapProvider(provider: LLMProvider, hooks: ProviderHooks): LLMProvider {
  return {
    async chat(messages: Array<Message>, tools?: Array<ToolDef>): Promise<LLMResponse> {
      if (hooks.beforeChat) {
        await hooks.beforeChat(messages, tools);
      }

      const response = await provider.chat(messages, tools);

      if (hooks.afterChat) {
        await hooks.afterChat(response);
      }

      return response;
    },
    async *chatStream(
      messages: Array<Message>,
      tools?: Array<ToolDef>
    ): AsyncIterable<LLMStreamEvent> {
      if (hooks.beforeChat) {
        await hooks.beforeChat(messages, tools);
      }

      const chunks: Array<LLMStreamEvent> = [];
      let finalStopReason = "end_turn";
      let finalUsage = { inputTokens: 0, outputTokens: 0 };
      let collectedText = "";

      for await (const chunk of provider.chatStream(messages, tools)) {
        chunks.push(chunk);
        yield chunk;

        if (chunk.type === "text_delta") {
          collectedText += chunk.content;
        } else if (chunk.type === "message_end") {
          finalStopReason = chunk.stopReason;
          finalUsage = chunk.usage;
        }
      }

      if (hooks.afterChat) {
        const syntheticResponse: LLMResponse = {
          content: collectedText ? [{ text: collectedText, type: "text" }] : [],
          stopReason: finalStopReason as LLMResponse["stopReason"],
          usage: finalUsage,
        };
        await hooks.afterChat(syntheticResponse);
      }
    },

    contextWindowSize: provider.contextWindowSize,
    maxOutputTokens: provider.maxOutputTokens,
  };
}
