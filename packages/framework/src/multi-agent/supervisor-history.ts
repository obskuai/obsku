import { extractText } from "../graph/node-executor";
import type { Message } from "../types";

function createAssistantHistoryMessage(text: string): Message {
  return {
    content: [{ text, type: "text" }],
    role: "assistant",
  };
}

export function appendAssistantHistory(history: Array<Message>, text: string): void {
  history.push(createAssistantHistoryMessage(text));
}

export function buildSupervisorMessages(
  context: string,
  history: Array<Message>,
  promptValue: string
): Array<Message> {
  return [
    {
      content: [{ text: `${promptValue}\n\n${context}`.trim(), type: "text" }],
      role: "user",
    },
    ...history,
  ];
}

function buildHistoryTranscript(history: Array<Message>): string {
  return history.map((message) => extractText(message.content)).join("\n");
}

export function buildWorkerInput(context: string, history: Array<Message>): string {
  const historyText = buildHistoryTranscript(history);
  return historyText.length > 0 ? `${context}\n${historyText}` : context;
}
