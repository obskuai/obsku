import {
  type Agent,
  type AgentDef,
  type AgentEvent,
  agent,
  type DefaultPublicPayload,
  type LLMProvider,
} from "@obsku/framework";
import { Registry } from "../scanner/registry.js";
import type {
  ExecutableAgent,
  ExecutableAgentRegistry,
  ExecutableAgentRunOptions,
} from "./routes/chat.js";

const DEFAULT_MODEL =
  process.env.STUDIO_MODEL ?? process.env.OBSKU_STUDIO_MODEL ?? "amazon.nova-lite-v1:0";
const DEFAULT_REGION = process.env.STUDIO_AWS_REGION ?? process.env.AWS_REGION ?? "us-east-1";
const DEFAULT_MAX_OUTPUT_TOKENS = Number.parseInt(
  process.env.STUDIO_MAX_OUTPUT_TOKENS ?? "1024",
  10
);
const DEFAULT_CONTEXT_WINDOW_SIZE = Number.parseInt(
  process.env.STUDIO_CONTEXT_WINDOW_SIZE ?? "300000",
  10
);
const BEDROCK_MODULE = "@obsku/provider-bedrock";

export interface EventRecorder {
  recordEvent(event: AgentEvent | DefaultPublicPayload<AgentEvent>): Promise<void>;
}

export class RegistryBackedExecutableAgentRegistry implements ExecutableAgentRegistry {
  private providerPromise?: Promise<LLMProvider>;

  constructor(
    private readonly registry: Registry,
    private readonly eventRecorder?: EventRecorder
  ) {}

  async getExecutable(agentName: string): Promise<ExecutableAgent | undefined> {
    const executable = await this.registry.getExecutableAgent(agentName);
    if (!executable) {
      return undefined;
    }

    return {
      run: async (input: string, options?: ExecutableAgentRunOptions) => {
        const provider = await this.getProvider();
        const onEvent = (event: DefaultPublicPayload<AgentEvent>) => {
          const decoratedEvent = withRuntimeModel(event);

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

  private getProvider(): Promise<LLMProvider> {
    if (!this.providerPromise) {
      this.providerPromise = loadBedrockProvider({
        contextWindowSize: Number.isFinite(DEFAULT_CONTEXT_WINDOW_SIZE)
          ? DEFAULT_CONTEXT_WINDOW_SIZE
          : 300000,
        maxOutputTokens: Number.isFinite(DEFAULT_MAX_OUTPUT_TOKENS)
          ? DEFAULT_MAX_OUTPUT_TOKENS
          : 1024,
        model: DEFAULT_MODEL,
        region: DEFAULT_REGION,
      });
    }

    return this.providerPromise;
  }
}

function isAgentDef(value: Agent | AgentDef): value is AgentDef {
  return "prompt" in value;
}

function withRuntimeModel(
  event: DefaultPublicPayload<AgentEvent>
): DefaultPublicPayload<AgentEvent> {
  const data =
    "data" in event && typeof event.data === "object" && event.data !== null ? event.data : {};

  return {
    ...event,
    data: {
      ...data,
      runtimeModel: DEFAULT_MODEL,
    },
  } as unknown as DefaultPublicPayload<AgentEvent>;
}

async function loadBedrockProvider(config: {
  contextWindowSize: number;
  maxOutputTokens: number;
  model: string;
  region: string;
}): Promise<LLMProvider> {
  const { bedrock } = (await import(BEDROCK_MODULE)) as {
    bedrock(options: typeof config): Promise<LLMProvider>;
  };

  return bedrock(config);
}
