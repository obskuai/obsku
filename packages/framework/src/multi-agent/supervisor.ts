// =============================================================================
// @obsku/framework — Supervisor multi-agent orchestration
// =============================================================================

import { graph } from "../graph/builder";
import { extractText } from "../graph/node-executor";
import type { Graph, GraphNode } from "../graph/types";
import type { DefaultPublicPayload } from "../output-policy";
import { loadOutputPolicy, wrapCallback } from "../output-policy";
import type { AgentDef, AgentEvent, LLMProvider, Message } from "../types";
import { MultiAgentConfigError } from "./errors";
import { dispatchToWorker } from "./supervisor-dispatch";
import { buildSupervisorMessages, buildWorkerInput } from "./supervisor-history";
import {
  buildRoutingFallbackError,
  buildSupervisorPrompt,
  parseSupervisorOutput,
  parseSupervisorOutputResult,
} from "./supervisor-routing";

export interface SupervisorConfig {
  maxRounds?: number;
  name: string;
  onEvent?: (event: DefaultPublicPayload<AgentEvent>) => void;
  prompt?: string;
  provider: LLMProvider;
  workers: Array<AgentDef>;
}

export { buildSupervisorPrompt, parseSupervisorOutput };

export function supervisor(config: SupervisorConfig): Graph {
  const { maxRounds = 5, name, provider, workers } = config;
  const onEvent = config.onEvent;
  const loadedPolicy = loadOutputPolicy();

  if (workers.length === 0) {
    throw new MultiAgentConfigError("Supervisor requires at least one worker");
  }

  const supervisorAgent: AgentDef = {
    name,
    prompt: config.prompt ?? buildSupervisorPrompt(workers),
  };

  const workerMap = new Map(workers.map((worker) => [worker.name, worker]));

  const supervisorExecutor = async (input: unknown): Promise<unknown> => {
    const context = typeof input === "string" ? input : JSON.stringify(input);
    const history: Array<Message> = [];
    const results: Record<string, string> = {};
    const emitEvent = onEvent
      ? wrapCallback(onEvent, loadedPolicy.createPolicy(), "callback")
      : undefined;

    for (let round = 0; round < maxRounds; round += 1) {
      const promptValue =
        typeof supervisorAgent.prompt === "function"
          ? await supervisorAgent.prompt({
              input: context,
              messages: history,
              sessionId: undefined,
            })
          : supervisorAgent.prompt;

      const supervisorMessages = buildSupervisorMessages(context, history, promptValue);

      const supervisorResponse = await provider.chat(supervisorMessages);
      const supervisorOutput = extractText(supervisorResponse.content);
      const routingResult = parseSupervisorOutputResult(supervisorOutput);
      const routing = routingResult.output;

      if (routingResult.status === "fallback-finish" && typeof supervisorOutput === "string") {
        emitEvent?.({
          error: buildRoutingFallbackError(routingResult.reason),
          rawInput: supervisorOutput,
          timestamp: Date.now(),
          type: "parse.error",
        });
      }

      emitEvent?.({
        next: routing.next,
        round,
        timestamp: Date.now(),
        type: "supervisor.routing",
      });

      if (routing.next === "FINISH") {
        emitEvent?.({
          rounds: round,
          timestamp: Date.now(),
          type: "supervisor.finish",
        });
        break;
      }

      const worker = workerMap.get(routing.next);
      if (!worker) {
        emitEvent?.({
          next: routing.next,
          round,
          timestamp: Date.now(),
          type: "supervisor.routing.failed",
        });
        break;
      }

      const workerInput = buildWorkerInput(context, history);

      results[routing.next] = await dispatchToWorker(
        worker,
        workerInput,
        history,
        round,
        provider,
        onEvent
      );
    }

    return { finalContext: history, results };
  };

  const nodes: Array<GraphNode> = [{ executor: supervisorExecutor, id: name }];

  return graph({ edges: [], entry: name, nodes, provider });
}
