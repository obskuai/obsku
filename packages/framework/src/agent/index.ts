import { Effect, Layer } from "effect";
import { DEFAULTS } from "../defaults";
import { generateId } from "../id-utils";
import { plugin as createPlugin } from "../plugin/index";
import { makeConfigLayer } from "../services/config";
import { destroySessionEventBus, EventBus, getSessionEventBus } from "../services/event-bus";
import { withSpan } from "../telemetry/tracer";
import type {
  AgentDef,
  AgentEvent,
  AgentFactoryConfig,
  AgentRunOptions,
  LLMProvider,
} from "../types/index";
import { createProgram } from "./run-program/index";
import {
  AgentFactoryRegistry,
  createCallAgentTool,
  createCreateAgentTool,
  createExecuteAgentTool,
  type ResolvedTool,
  type SetupContext,
  setupPlugins,
} from "./setup";
import { pluginDefToToolDef } from "./tool-executor";

function resolveAgentFactoryConfig(
  agentFactory: AgentDef["agentFactory"]
): AgentFactoryConfig | undefined {
  if (!agentFactory) {
    return undefined;
  }
  if (agentFactory === true) {
    return {};
  }
  return agentFactory;
}

/**
 * Agent interface returned by the agent() factory function.
 * Provides a type-safe way to reference agents with IDE autocomplete.
 */
export interface Agent {
  readonly name: string;
  /**
   * Execute the agent's ReAct loop with the given input and LLM provider.
   * @param input - User message or task description to process.
   * @param provider - LLM provider (e.g. Bedrock, OpenAI) for chat completions.
   * @param options - Session, event, and checkpoint configuration.
   * @returns Final text response from the agent after tool use and reasoning.
   * @example
   * ```ts
   * const result = await myAgent.run("Scan example.com", bedrockProvider)
   * ```
   */
  run(input: string, provider: LLMProvider, options?: AgentRunOptions): Promise<string>;
  /**
   * Subscribe to the agent's event stream without running it.
   * Returns an async iterable of typed AgentEvent objects for real-time UI or logging.
   * @param options - Optional session ID and event bus capacity.
   * @returns Async iterable that yields AgentEvent objects as they occur.
   * @example
   * ```ts
   * const events = await myAgent.subscribe()
   * for await (const event of events) { console.log(event.type) }
   * ```
   */
  subscribe(
    options?: Pick<AgentRunOptions, "eventBusCapacity" | "sessionId">
  ): Promise<AsyncIterable<AgentEvent>>;
}

function startOnEventForwarder(
  eventBus: Awaited<ReturnType<typeof getSessionEventBus>>,
  onEvent: (event: AgentEvent) => void
) {
  const iterator = eventBus.subscribe()[Symbol.asyncIterator]();

  const task = (async () => {
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        return;
      }
      onEvent(next.value);
    }
  })();

  return async () => {
    await Promise.race([
      Promise.allSettled([iterator.return?.(), task.catch(() => undefined)]),
      new Promise((resolve) => setTimeout(resolve, 100)),
    ]);
  };
}

function resolvePluginsAndTools(setupCtx: ReturnType<typeof setupPlugins>) {
  return {
    resolvedTools: new Map(setupCtx.resolvedTools),
    toolDefs: [...setupCtx.toolDefs],
  };
}

type ResolvedPluginsAndTools = ReturnType<typeof resolvePluginsAndTools>;

async function createSessionBus(sessionId: string, eventBusCapacity: number | undefined) {
  return getSessionEventBus(sessionId, { capacity: eventBusCapacity });
}

function buildEffectLayers(
  def: AgentDef,
  eventBus: Awaited<ReturnType<typeof getSessionEventBus>>
) {
  return {
    configLayer: makeConfigLayer({
      maxIterations: def.maxIterations ?? 10,
      toolConcurrency: def.toolConcurrency ?? 3,
      toolTimeout: def.toolTimeout ?? DEFAULTS.toolTimeout,
    }),
    eventBusLayer: Layer.succeed(EventBus, eventBus),
  };
}

function wireAgentFactoryTools(
  agentFactory: AgentDef["agentFactory"],
  provider: LLMProvider,
  resolvedTools: Map<string, ResolvedTool>,
  toolDefs: ResolvedPluginsAndTools["toolDefs"]
) {
  const factoryConfig = resolveAgentFactoryConfig(agentFactory);
  if (!factoryConfig) {
    return undefined;
  }

  const factoryRegistry = new AgentFactoryRegistry(provider, factoryConfig);
  const createAgentTool = createCreateAgentTool(factoryRegistry, provider);
  const callAgentTool = createCallAgentTool(factoryRegistry);
  const executeAgentTool = createExecuteAgentTool(factoryRegistry, provider);

  resolvedTools.set(createAgentTool.name, {
    middleware: [],
    plugin: createPlugin(createAgentTool),
  });
  resolvedTools.set(callAgentTool.name, {
    middleware: [],
    plugin: createPlugin(callAgentTool),
  });
  resolvedTools.set(executeAgentTool.name, {
    middleware: [],
    plugin: createPlugin(executeAgentTool),
  });
  toolDefs.push(pluginDefToToolDef(createAgentTool));
  toolDefs.push(pluginDefToToolDef(callAgentTool));
  toolDefs.push(pluginDefToToolDef(executeAgentTool));

  return factoryRegistry;
}

function createAgentProgram(
  setupCtx: SetupContext,
  def: AgentDef,
  input: string,
  provider: LLMProvider,
  options: AgentRunOptions,
  sessionId: string,
  checkpointStore: AgentRunOptions["checkpointStore"],
  resolvedTools: ResolvedPluginsAndTools["resolvedTools"],
  toolDefs: ResolvedPluginsAndTools["toolDefs"],
  factoryRegistry: AgentFactoryRegistry | undefined
) {
  return createProgram({
    bgToolNames: setupCtx.bgToolNames,
    checkpointStore,
    def,
    externalMessages: options.messages,
    factoryRegistry,
    handoffTargets: setupCtx.handoffTargets,
    input,
    provider,
    resolvedTools,
    responseFormat: options.responseFormat,
    sessionId,
    taskManager: setupCtx.taskManager,
    toolDefs,
  });
}

async function executeAgentProgram(
  program: ReturnType<typeof createProgram>,
  configLayer: ReturnType<typeof buildEffectLayers>["configLayer"],
  eventBusLayer: ReturnType<typeof buildEffectLayers>["eventBusLayer"],
  eventBus: Awaited<ReturnType<typeof getSessionEventBus>>,
  onEvent: AgentRunOptions["onEvent"],
  ownsSessionBus: boolean,
  sessionId: string
) {
  const stopForwarder = onEvent ? startOnEventForwarder(eventBus, onEvent) : undefined;

  try {
    const execution = Effect.scoped(
      Effect.gen(function* () {
        return yield* program;
      }).pipe(Effect.provide(configLayer), Effect.provide(eventBusLayer))
    );
    return await Effect.runPromise(execution);
  } finally {
    if (stopForwarder) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await stopForwarder?.();
    if (ownsSessionBus) {
      await destroySessionEventBus(sessionId);
    }
  }
}

function createAgentSubscriptionMethod(): Agent["subscribe"] {
  return async (options) => {
    const sessionId = options?.sessionId ?? generateId("session");
    const eventBus = await createSessionBus(sessionId, options?.eventBusCapacity);
    return eventBus.subscribe();
  };
}

function createAgentRunMethod(def: AgentDef, setupCtx: SetupContext): Agent["run"] {
  return async (input, provider, options) => {
    const opts = options ?? {};
    const sessionId = opts.sessionId ?? generateId("session");
    const ownsSessionBus = opts.sessionId === undefined;
    const eventBus = await createSessionBus(sessionId, opts.eventBusCapacity);
    const { configLayer, eventBusLayer } = buildEffectLayers(def, eventBus);
    const { resolvedTools, toolDefs } = resolvePluginsAndTools(setupCtx);
    const factoryRegistry = wireAgentFactoryTools(
      def.agentFactory,
      provider,
      resolvedTools,
      toolDefs
    );
    const program = createAgentProgram(
      setupCtx,
      def,
      input,
      provider,
      opts,
      sessionId,
      opts.checkpointStore,
      resolvedTools,
      toolDefs,
      factoryRegistry
    );

    return withSpan(
      def.telemetry,
      "agent.run",
      () =>
        executeAgentProgram(
          program,
          configLayer,
          eventBusLayer,
          eventBus,
          opts.onEvent,
          ownsSessionBus,
          sessionId
        ),
      {
        "agent.name": def.name,
      }
    );
  };
}

/**
 * Create an Agent from a declarative definition.
 * The returned Agent exposes a Promise-based API; Effect internals are hidden.
 * @param def - Agent definition with name, prompt, tools, and options.
 * @returns Agent instance with `run()` and `subscribe()` methods.
 * @example
 * ```ts
 * const assistant = agent({
 *   name: "assistant",
 *   prompt: "You are a helpful assistant.",
 *   tools: [echo],
 * })
 * ```
 */
export function agent(def: AgentDef): Agent {
  const setupCtx = setupPlugins(def);

  return {
    name: def.name,
    subscribe: createAgentSubscriptionMethod(),
    run: createAgentRunMethod(def, setupCtx),
  };
}
