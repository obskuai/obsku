import type { AgentDef, LLMProvider, Message } from "../types";

export interface HandoffTarget {
  agent: AgentDef;
  description: string;
}

export interface HandoffContext {
  messages: Array<Message>;
  provider: LLMProvider;
  sessionId?: string;
}
