import {
  type Agent,
  type AgentDef,
  type AgentEvent,
  agent,
  type DefaultPublicPayload,
  type LLMProvider,
} from "@obsku/framework";
import { Registry } from "../scanner/registry.js";
import type { ProviderResolution } from "./provider-adapter.js";
import type {
  ExecutableAgent,
  ExecutableAgentRegistry,
  ExecutableAgentRunOptions,
} from "./routes/chat.js";

const DEFAULT_MODEL = process.env.STUDIO_MODEL ?? process.env.OBSKU_STUDIO_MODEL;

export interface EventRecorder {
  recordEvent(event: AgentEvent | DefaultPublicPayload<AgentEvent>): Promise<void>;
}

export class RegistryBackedExecutableAgentRegistry implements ExecutableAgentRegistry {
  private readonly providerPromises = new Map<string, Promise<LLMProvider>>();

  constructor(
    private readonly registry: Registry,
    private readonly providerResolution: ProviderResolution,
    private readonly eventRecorder?: EventRecorder
  ) {}

  async getExecutable(agentName: string): Promise<ExecutableAgent | undefined> {
    const executable = await this.registry.getExecutableAgent(agentName);
    if (!executable) {
      return undefined;
    }

    return {
      run: async (input: string, options?: ExecutableAgentRunOptions) => {
        const runtimeModel = this.getRuntimeModel();
        const provider = await this.getProvider(runtimeModel);
        const onEvent = (event: DefaultPublicPayload<AgentEvent>) => {
          const decoratedEvent = withRuntimeModel(
            event,
            runtimeModel,
            this.providerResolution.provider.id
          );

          if (options?.onEvent) {
            options.onEvent(decoratedEvent);
          }

          if (this.eventRecorder) {
            void this.eventRecorder.recordEvent(decoratedEvent);
          }
        };

        if (isAgentDef(executable)) {
          return agent(executable).run(input, provider, {
            onEvent,
            sessionId: options?.sessionId,
          });
        }

        return executable.run(input, provider, {
          onEvent,
          sessionId: options?.sessionId,
        });
      },
    };
  }

  private getProvider(model: string): Promise<LLMProvider> {
    const providerId = this.providerResolution.provider.id;
    const cacheKey = `${providerId}:${model}`;

    const cached = this.providerPromises.get(cacheKey);
    if (cached) {
      return cached;
    }

    const providerPromise = this.providerResolution.provider.createProvider(model);
    this.providerPromises.set(cacheKey, providerPromise);
    return providerPromise;
  }

  private getRuntimeModel(): string {
    return DEFAULT_MODEL ?? this.providerResolution.provider.getDefaultModel();
  }
}

function isAgentDef(value: Agent | AgentDef): value is AgentDef {
  return "prompt" in value;
}

function withRuntimeModel(
  event: DefaultPublicPayload<AgentEvent>,
  runtimeModel: string,
  runtimeProvider: ProviderResolution["provider"]["id"]
): DefaultPublicPayload<AgentEvent> {
  const data =
    "data" in event && typeof event.data === "object" && event.data !== null ? event.data : {};

  return {
    ...event,
    data: {
      ...data,
      runtimeModel,
      runtimeProvider,
    },
  } as unknown as DefaultPublicPayload<AgentEvent>;
}
