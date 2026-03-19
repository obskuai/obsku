import { agent } from "../agent/index";
import { DEFAULTS } from "../defaults";
import { getErrorMessage } from "../error-utils";
import type { AgentDef, AgentEvent, LLMProvider, Message } from "../types";
import { appendAssistantHistory } from "./supervisor-history";

export async function dispatchToWorker(
  worker: AgentDef,
  input: string,
  history: Array<Message>,
  round: number,
  provider: LLMProvider,
  onEvent: ((event: AgentEvent) => void) | undefined
): Promise<string> {
  try {
    const workerResult = await agent(worker).run(input, provider, {
      onEvent,
    });
    const trimmedResult = workerResult.trimEnd();
    appendAssistantHistory(history, trimmedResult);
    const truncatedResult =
      workerResult.length > DEFAULTS.supervisor.outputPreviewLength
        ? `${workerResult.slice(0, DEFAULTS.supervisor.outputPreviewLength)}...`
        : workerResult.slice(0, DEFAULTS.supervisor.outputPreviewLength);
    onEvent?.({
      output: truncatedResult,
      round,
      timestamp: Date.now(),
      type: "supervisor.worker_output",
      worker: worker.name,
    });
    return trimmedResult;
  } catch (error: unknown) {
    const errorMessage = `Worker ${worker.name} failed: ${getErrorMessage(error)}`;
    appendAssistantHistory(history, errorMessage);
    appendAssistantHistory(history, errorMessage);
    return errorMessage;
  }
}
