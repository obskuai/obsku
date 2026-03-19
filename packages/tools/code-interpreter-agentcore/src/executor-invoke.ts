import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import {
  InvokeCodeInterpreterCommand,
  type InvokeCodeInterpreterCommandInput,
  type ToolName,
} from "@aws-sdk/client-bedrock-agentcore";
import { collectStructuredContent, type InvokeResult, type StructuredContent } from "./parser";

export type StructuredContentInvoker = (
  name: ToolName,
  args?: Record<string, unknown>,
  abortSignal?: AbortSignal
) => Promise<StructuredContent | undefined>;

export function createStructuredContentInvoker(
  client: BedrockAgentCoreClient,
  codeInterpreterIdentifier: string,
  sessionId: string
): StructuredContentInvoker {
  return async (name, args, abortSignal) => {
    const input: InvokeCodeInterpreterCommandInput = {
      codeInterpreterIdentifier,
      name,
      sessionId,
    };
    if (args !== undefined) {
      input.arguments = args;
    }
    const response = (await client.send(
      new InvokeCodeInterpreterCommand(input),
      abortSignal ? { abortSignal } : undefined
    )) as InvokeResult;
    return collectStructuredContent(response.stream);
  };
}
