import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import {
  StartCodeInterpreterSessionCommand,
  StopCodeInterpreterSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { getErrorMessage, debugLog } from "@obsku/framework";
import { rethrowStageError } from "./executor-stage-error";

export async function startSession(
  client: BedrockAgentCoreClient,
  codeInterpreterIdentifier: string,
  abortSignal: AbortSignal
): Promise<string> {
  try {
    const start = await client.send(
      new StartCodeInterpreterSessionCommand({ codeInterpreterIdentifier }),
      { abortSignal }
    );
    if (!start.sessionId) {
      throw new Error("Failed to start AgentCore code interpreter session");
    }
    return start.sessionId;
  } catch (error: unknown) {
    rethrowStageError("startSession", error);
  }
}

export async function stopSession(
  client: BedrockAgentCoreClient,
  codeInterpreterIdentifier: string,
  sessionId: string | undefined
): Promise<string | undefined> {
  if (!sessionId) {
    return undefined;
  }
  try {
    await client.send(
      new StopCodeInterpreterSessionCommand({
        codeInterpreterIdentifier,
        sessionId,
      })
    );
    return undefined;
  } catch (error: unknown) {
    debugLog(`Session cleanup failed: ${error}`);
    return getErrorMessage(error);
  }
}
