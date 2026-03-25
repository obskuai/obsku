import { describe, expect, it, mock } from "bun:test";
import type { AgentEvent, DefaultPublicPayload, LLMProvider } from "@obsku/framework";
import { RegistryBackedExecutableAgentRegistry } from "../../src/server/executable-agent-registry.js";
import type { ProviderResolution } from "../../src/server/provider-adapter.js";

function createResolution(
  overrides: Partial<ProviderResolution["provider"]> = {}
): ProviderResolution {
  return {
    provider: {
      id: "openai",
      name: "OpenAI",
      createProvider: mock(async () => ({}) as Promise<LLMProvider>),
      getDefaultModel: () => "gpt-4o-mini",
      listModels: () => ["gpt-4o-mini"],
      ...overrides,
    },
    source: "config",
  };
}

describe("RegistryBackedExecutableAgentRegistry", () => {
  it("creates providers through the resolved adapter", async () => {
    const createProvider = mock(async (_model: string) => ({}) as LLMProvider);
    const executable = {
      run: mock(async () => "done"),
    };
    const registry = new RegistryBackedExecutableAgentRegistry(
      {
        getExecutableAgent: async () => executable,
      } as never,
      createResolution({ createProvider })
    );

    const resolved = await registry.getExecutable("demo");

    await resolved?.run("hello");

    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(createProvider).toHaveBeenCalledWith("gpt-4o-mini");
  });

  it("caches providers for repeated runs with the same provider/model pair", async () => {
    const provider = {} as LLMProvider;
    const createProvider = mock(async (_model: string) => provider);
    const executable = {
      run: mock(async () => "done"),
    };
    const registry = new RegistryBackedExecutableAgentRegistry(
      {
        getExecutableAgent: async () => executable,
      } as never,
      createResolution({ createProvider })
    );

    const resolved = await registry.getExecutable("demo");

    await resolved?.run("first");
    await resolved?.run("second");

    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(executable.run).toHaveBeenNthCalledWith(1, "first", provider, expect.any(Object));
    expect(executable.run).toHaveBeenNthCalledWith(2, "second", provider, expect.any(Object));
  });

  it("injects runtime model and runtime provider into emitted events", async () => {
    const executable = {
      run: mock(
        async (
          _input: string,
          _provider: LLMProvider,
          options?: {
            onEvent?: (event: DefaultPublicPayload<AgentEvent>) => void;
          }
        ) => {
          options?.onEvent?.({
            type: "stream.chunk",
            timestamp: Date.now(),
            data: { content: "hi" },
          } as DefaultPublicPayload<AgentEvent>);

          return "done";
        }
      ),
    };
    const registry = new RegistryBackedExecutableAgentRegistry(
      {
        getExecutableAgent: async () => executable,
      } as never,
      createResolution({ id: "anthropic", getDefaultModel: () => "claude-sonnet-4-20250514" })
    );

    const resolved = await registry.getExecutable("demo");
    const events: Array<DefaultPublicPayload<AgentEvent>> = [];

    await resolved?.run("hello", {
      onEvent: (event) => events.push(event),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({
      content: "hi",
      runtimeModel: "claude-sonnet-4-20250514",
      runtimeProvider: "anthropic",
    });
  });
});
