// =============================================================================
// @obsku/framework — Supervisor multi-agent orchestration
// =============================================================================

import { graph } from "../graph/builder";
import { extractText } from "../graph/node-executor";
import type { Graph, GraphNode } from "../graph/types";
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
  onEvent?: (event: AgentEvent) => void;
  prompt?: string;
  provider: LLMProvider;
  workers: Array<AgentDef>;
}

export { buildSupervisorPrompt, parseSupervisorOutput };

export function supervisor(config: SupervisorConfig): Graph {
  const { maxRounds = 5, name, provider, workers } = config;

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
        config.onEvent?.({
          error: buildRoutingFallbackError(routingResult.reason),
          rawInput: supervisorOutput,
          timestamp: Date.now(),
          type: "parse.error",
        });
      }

      config.onEvent?.({
        next: routing.next,
        round,
        timestamp: Date.now(),
        type: "supervisor.routing",
      });

      if (routing.next === "FINISH") {
        config.onEvent?.({
          rounds: round,
          timestamp: Date.now(),
          type: "supervisor.finish",
        });
        break;
      }

      const worker = workerMap.get(routing.next);
      if (!worker) {
        config.onEvent?.({
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
        config.onEvent
      );
    }

    return { finalContext: history, results };
  };

  const nodes: Array<GraphNode> = [{ executor: supervisorExecutor, id: name }];

  return graph({ edges: [], entry: name, nodes, provider });
}
