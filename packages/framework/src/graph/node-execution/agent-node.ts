import { agent } from "../../agent/index";
import type { AgentDef, AgentEvent, LLMProvider, Message } from "../../types";
import type { ExecuteGraphOptions } from "../types";
import { extractText } from "./text";
import { completeNodeExecution, type NodeExecutionOutcome } from "./types";

interface ExecuteAgentNodeOptions {
  readonly input: string;
  readonly onEvent?: (event: AgentEvent) => void;
  readonly options?: ExecuteGraphOptions;
  readonly provider: LLMProvider;
}

export async function executeAgentNode(
  executor: AgentDef,
  { input, onEvent, options, provider }: ExecuteAgentNodeOptions
): Promise<NodeExecutionOutcome> {
  const hasTools = executor.tools && executor.tools.length > 0;

  if (hasTools) {
    return completeNodeExecution(
      await agent(executor).run(input, provider, {
        checkpointStore: options?.checkpointStore,
        onEvent,
        sessionId: options?.sessionId,
      })
    );
  }

  const promptValue =
    typeof executor.prompt === "function"
      ? await executor.prompt({ input, messages: [], sessionId: undefined })
      : executor.prompt;
  const messages: Array<Message> = [
    {
      content: [{ text: `${promptValue}\n\n${input}`.trim(), type: "text" }],
      role: "user",
    },
  ];

  const response = await provider.chat(messages);
  return completeNodeExecution(extractText(response.content));
}
