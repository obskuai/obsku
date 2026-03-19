import { type ConversationMessage, isRecord, MessageRole } from "@obsku/framework";

interface ParsedRequest {
  input: string;
  messages?: Array<ConversationMessage>;
  model?: string;
  sessionId?: string;
}

function parseMessages(raw: Array<unknown>): Array<ConversationMessage> {
  return raw.map((message) => {
    if (!isRecord(message) || !("content" in message)) {
      return { content: "", role: "user" as const };
    }
    const msgContent = message.content;
    let content: string;
    if (typeof msgContent === "string") {
      content = msgContent;
    } else if (Array.isArray(msgContent)) {
      content = msgContent
        .map((contentBlock) => {
          if (
            isRecord(contentBlock) &&
            "text" in contentBlock &&
            typeof contentBlock.text === "string"
          ) {
            return contentBlock.text;
          }
          return "";
        })
        .join("\n");
    } else {
      content = "";
    }
    const role = typeof message.role === "string" ? message.role : "";
    return { content, role: role === "assistant" ? "assistant" : "user" };
  });
}

export function parseAgentCoreRequest(body: unknown): ParsedRequest {
  // Validation
  if (!isRecord(body)) {
    throw new Error("Request body must be an object");
  }

  // Extract input with priority: message > prompt[] > messages[-1]
  let input: string | undefined;
  let messages: ConversationMessage[] | undefined;

  if (typeof body.message === "string") {
    input = body.message;
  } else if (Array.isArray(body.prompt)) {
    input = body.prompt
      .map((prompt) => {
        if (isRecord(prompt) && "text" in prompt && typeof prompt.text === "string") {
          return prompt.text;
        }
        return "";
      })
      .join("\n");
  } else if (Array.isArray(body.messages)) {
    // Convert messages to ConversationMessage[], extract last user message as input
    const msgs = parseMessages(body.messages);

    // Find last user message as current input
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === MessageRole.USER) {
        input = msgs[i].content;
        messages = msgs.slice(0, i); // Everything before is history
        break;
      }
    }
    if (!input && msgs.length > 0) {
      input = msgs.at(-1)?.content;
      messages = msgs.slice(0, -1);
    }
  }

  // Extract messages independently when input came from message/prompt
  if (!messages && Array.isArray(body.messages)) {
    messages = parseMessages(body.messages);
  }

  if (!input) {
    throw new Error("No input found in request");
  }

  // Extract model
  let model: string | undefined;
  if (isRecord(body.model) && "modelId" in body.model && typeof body.model.modelId === "string") {
    model = body.model.modelId;
  } else if (typeof body.model === "string") {
    model = body.model;
  }

  return {
    input,
    messages,
    model,
    sessionId: typeof body.session_id === "string" ? body.session_id : undefined,
  };
}
