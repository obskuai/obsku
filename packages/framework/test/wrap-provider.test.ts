import { describe, expect, test } from "bun:test";
import type { LLMProvider, LLMResponse, LLMStreamEvent, Message, ToolDef } from "../src/types";
import { type ProviderHooks, wrapProvider } from "../src/wrap-provider";

function makeMockProvider(
  chatFn: (msgs: Array<Message>, tools?: Array<ToolDef>) => Promise<LLMResponse>,
  chatStreamFn?: (msgs: Array<Message>, tools?: Array<ToolDef>) => AsyncIterable<LLMStreamEvent>
): LLMProvider {
  return {
    chat: chatFn,
    chatStream:
      chatStreamFn ??
      async function* () {
        yield { content: "", type: "text_delta" };
      },
    contextWindowSize: 200_000,
  };
}

function textResponse(text: string): LLMResponse {
  return {
    content: [{ text, type: "text" }],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

function streamResponse(text: string): Array<LLMStreamEvent> {
  return [
    { content: text, type: "text_delta" },
    { stopReason: "end_turn", type: "message_end", usage: { inputTokens: 10, outputTokens: 5 } },
  ];
}

describe("wrapProvider", () => {
  test("intercepts chat() - beforeChat receives messages+tools, afterChat receives response", async () => {
    const beforeChatCalls: Array<{ messages: Array<Message>; tools?: Array<ToolDef> }> = [];
    const afterChatCalls: Array<LLMResponse> = [];

    const hooks: ProviderHooks = {
      afterChat: (response) => {
        afterChatCalls.push(response);
      },
      beforeChat: (messages, tools) => {
        beforeChatCalls.push({ messages: [...messages], tools: tools ? [...tools] : undefined });
      },
    };

    const mockProvider = makeMockProvider(async () => textResponse("Hello"));
    const wrapped = wrapProvider(mockProvider, hooks);

    const messages: Array<Message> = [{ content: [{ text: "hi", type: "text" }], role: "user" }];
    const tools: Array<ToolDef> = [
      { description: "test tool", inputSchema: { properties: {}, type: "object" }, name: "test" },
    ];

    const response = await wrapped.chat(messages, tools);

    expect(response).toEqual(textResponse("Hello"));
    expect(beforeChatCalls).toHaveLength(1);
    expect(beforeChatCalls[0].messages).toEqual(messages);
    expect(beforeChatCalls[0].tools).toEqual(tools);
    expect(afterChatCalls).toHaveLength(1);
    expect(afterChatCalls[0]).toEqual(textResponse("Hello"));
  });

  test("intercepts chatStream() - beforeChat called, afterChat called with collected chunks", async () => {
    const beforeChatCalls: Array<{ messages: Array<Message>; tools?: Array<ToolDef> }> = [];
    const afterChatCalls: Array<LLMResponse> = [];

    const hooks: ProviderHooks = {
      afterChat: (response) => {
        afterChatCalls.push(response);
      },
      beforeChat: (messages, tools) => {
        beforeChatCalls.push({ messages: [...messages], tools: tools ? [...tools] : undefined });
      },
    };

    const streamEvents = streamResponse("Streaming response");
    const mockProvider = makeMockProvider(
      async () => textResponse(""),
      async function* () {
        for (const event of streamEvents) {
          yield event;
        }
      }
    );

    const wrapped = wrapProvider(mockProvider, hooks);
    const messages: Array<Message> = [
      { content: [{ text: "stream", type: "text" }], role: "user" },
    ];

    const chunks: Array<LLMStreamEvent> = [];
    for await (const chunk of wrapped.chatStream(messages)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(streamEvents);
    expect(beforeChatCalls).toHaveLength(1);
    expect(beforeChatCalls[0].messages).toEqual(messages);
    expect(afterChatCalls).toHaveLength(1);
    expect(afterChatCalls[0].content).toEqual([{ text: "Streaming response", type: "text" }]);
    expect(afterChatCalls[0].stopReason).toBe("end_turn");
  });

  test("wrapper without hooks passes through unchanged", async () => {
    const mockProvider = makeMockProvider(async () => textResponse("Original"));
    const wrapped = wrapProvider(mockProvider, {});

    const messages: Array<Message> = [{ content: [{ text: "test", type: "text" }], role: "user" }];
    const response = await wrapped.chat(messages);

    expect(response).toEqual(textResponse("Original"));
  });

  test("beforeChat can modify messages array (mutability check)", async () => {
    const hooks: ProviderHooks = {
      beforeChat: (messages) => {
        messages.push({ content: [{ text: "Injected", type: "text" }], role: "assistant" });
      },
    };

    let receivedMessages: Array<Message> = [];
    const mockProvider = makeMockProvider(async (msgs) => {
      receivedMessages = [...msgs];
      return textResponse("Response");
    });

    const wrapped = wrapProvider(mockProvider, hooks);
    const messages: Array<Message> = [{ content: [{ text: "hi", type: "text" }], role: "user" }];

    await wrapped.chat(messages);

    expect(receivedMessages).toHaveLength(2);
    expect(receivedMessages[1]).toEqual({
      content: [{ text: "Injected", type: "text" }],
      role: "assistant",
    });
  });

  test("nested wrapProvider(wrapProvider(...)) works", async () => {
    const callOrder: Array<string> = [];

    const innerHooks: ProviderHooks = {
      afterChat: () => callOrder.push("inner-after"),
      beforeChat: () => callOrder.push("inner-before"),
    };

    const outerHooks: ProviderHooks = {
      afterChat: () => callOrder.push("outer-after"),
      beforeChat: () => callOrder.push("outer-before"),
    };

    const mockProvider = makeMockProvider(async () => textResponse("Test"));
    const innerWrapped = wrapProvider(mockProvider, innerHooks);
    const outerWrapped = wrapProvider(innerWrapped, outerHooks);

    await outerWrapped.chat([{ content: [{ text: "test", type: "text" }], role: "user" }]);

    expect(callOrder).toEqual(["outer-before", "inner-before", "inner-after", "outer-after"]);
  });

  test("wrapper error propagates as-is", async () => {
    const error = new Error("Provider failed");
    const mockProvider = makeMockProvider(async () => {
      throw error;
    });

    const hooks: ProviderHooks = {
      afterChat: () => {},
      beforeChat: () => {},
    };

    const wrapped = wrapProvider(mockProvider, hooks);

    await expect(
      wrapped.chat([{ content: [{ text: "test", type: "text" }], role: "user" }])
    ).rejects.toThrow("Provider failed");
  });
});
