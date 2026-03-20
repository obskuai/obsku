import {
  type BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import type { LLMResponse } from "@obsku/framework";
import { fromBedrockContent, mapStopReason } from "./converters";
import { mapAwsError } from "./errors";

function mapBedrockResponse(response: ConverseCommandOutput): LLMResponse {
  return {
    content: fromBedrockContent(response.output?.message?.content ?? []),
    stopReason: mapStopReason(response.stopReason),
    usage: {
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
    },
  };
}

export async function chatWithFallback(
  client: BedrockRuntimeClient,
  buildCommand: (includeOutput: boolean) => ConverseCommand,
  shouldUseStructuredOutput: boolean,
  modelId: string,
  cache: Map<string, boolean>
): Promise<LLMResponse> {
  try {
    const command = buildCommand(shouldUseStructuredOutput);
    const response = await client.send(command);
    return mapBedrockResponse(response);
  } catch (error: unknown) {
    if (error instanceof Error) {
      const isOutputConfigError =
        error.name === "ValidationException" && error.message.includes("outputConfig");
      if (isOutputConfigError && shouldUseStructuredOutput) {
        cache.set(modelId, false);
        const fallbackCommand = buildCommand(false);
        const response = await client.send(fallbackCommand);
        return mapBedrockResponse(response);
      }
    }
    throw mapAwsError(error);
  }
}
