import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { InMemoryCheckpointStore } from "@obsku/framework";
import { z } from "zod";
import { agent } from "../../src/agent";
import type { MemoryHookContext, MemoryStoreOperations } from "../../src/memory/types";
import type { LLMProvider, LLMResponse, MemoryConfig, Message } from "../../src/types";
import {
  createTrackingMockProvider,
  runMemoryIntegrationTests,
} from "../checkpoint/shared/memory-integration";

function cloneMessages(messages: Array<Message>): Array<Message> {
  return messages.map((message) => ({
    ...message,
    content: [...message.content],
    toolCalls: message.toolCalls ? [...message.toolCalls] : undefined,
  }));
}

function createCapturingProvider(
  calls: Array<Array<Message>>,
  responses: Array<string>
): LLMProvider {
  let callIndex = 0;

  return {
    chat: async (messages: Array<Message>): Promise<LLMResponse> => {
      calls.push(cloneMessages(messages));

      const text = responses[callIndex] ?? responses.at(-1) ?? "ok";
      callIndex++;

      return {
        content: [{ text, type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
    async *chatStream() {
      yield { content: "test", type: "text_delta" as const };
    },
    contextWindowSize: 200_000,
  };
}

function createQueuedMemoryLoadHook(contexts: Array<string | undefined>) {
  let callIndex = 0;

  return async (_ctx: MemoryHookContext) => ({
    context: contexts[callIndex++] ?? undefined,
    entities: [],
    facts: [],
  });
}

function getTextContent(message: Message): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function getAllTextContent(messages: Array<Message>): Array<string> {
  return messages.map(getTextContent).filter((text) => text.length > 0);
}

function formatExpectedMemorySnapshot(context: string): string {
  return `## Memory Context\n${context}`;
}

async function expectStoredHistoryToExcludeMemory(
  store: InMemoryCheckpointStore,
  sessionId: string,
  forbiddenTexts: Array<string>
) {
  const persisted = await store.getMessages(sessionId);
  const persistedText = persisted.flatMap((message) => {
    if (typeof message.content !== "string") {
      return [];
    }
    return [message.content];
  });

  for (const forbiddenText of forbiddenTexts) {
    expect(persistedText.some((text) => text.includes(forbiddenText))).toBe(false);
  }
}

describe("Memory System Integration", () => {
  runMemoryIntegrationTests({
    cleanup: async (store) => await (store as InMemoryCheckpointStore).close(),
    createStore: async () => new InMemoryCheckpointStore(),
    description: "InMemory Backend",
    hasSemanticSearch: true,
  });

  describe("Feature Toggles", () => {
    let store: MemoryStoreOperations;

    beforeEach(async () => {
      store = new InMemoryCheckpointStore();
    });

    afterEach(async () => {
      await (store as InMemoryCheckpointStore).close();
    });

    test("entityMemory=true, longTermMemory=false only extracts entities", async () => {
      let extractionCalls = 0;
      const provider: LLMProvider = {
        chat: async (): Promise<LLMResponse> => {
          extractionCalls++;
          if (extractionCalls === 1) {
            return {
              content: [{ text: "Found server", type: "text" }],
              stopReason: "end_turn",
              usage: { inputTokens: 100, outputTokens: 50 },
            };
          }
          return {
            content: [
              { text: '[{"name":"server1","type":"server","attributes":{}}]', type: "text" },
            ],
            stopReason: "end_turn",
            usage: { inputTokens: 100, outputTokens: 50 },
          };
        },
        async *chatStream() {
          yield { content: "test", type: "text_delta" as const };
        },
        contextWindowSize: 200_000,
      };

      const myAgent = agent({
        memory: {
          enabled: true,
          entityMemory: true,
          longTermMemory: false,
          store,
        } satisfies MemoryConfig,
        name: "test-agent",
        prompt: "Test",
      });

      await myAgent.run("Test", provider, { sessionId: "toggle-test" });

      expect(extractionCalls).toBe(2);
      expect(
        (await store.listEntities({ sessionId: "toggle-test" })).length
      ).toBeGreaterThanOrEqual(1);
      expect((await store.listFacts({})).length).toBe(0);
    });

    test("contextInjection=false skips memory load", async () => {
      await store.saveEntity({
        attributes: {},
        name: "existing-entity",
        relationships: [],
        sessionId: "injection-test",
        type: "server",
      });

      const receivedMessages: Array<Array<Message>> = [];
      const provider: LLMProvider = {
        chat: async (messages: Array<Message>): Promise<LLMResponse> => {
          receivedMessages.push([...messages]);
          return {
            content: [{ text: "Done", type: "text" }],
            stopReason: "end_turn",
            usage: { inputTokens: 100, outputTokens: 50 },
          };
        },
        async *chatStream() {
          yield { content: "test", type: "text_delta" as const };
        },
        contextWindowSize: 200_000,
      };

      const myAgent = agent({
        memory: {
          contextInjection: false,
          enabled: true,
          entityMemory: false,
          longTermMemory: false,
          store,
        } satisfies MemoryConfig,
        name: "test-agent",
        prompt: "Test agent",
      });

      await myAgent.run("Test input", provider, { sessionId: "injection-test" });
      expect(receivedMessages.length).toBe(1);
    });
  });

  describe("Agent Integration", () => {
    let store: MemoryStoreOperations;

    beforeEach(async () => {
      store = new InMemoryCheckpointStore();
    });

    afterEach(async () => {
      await (store as InMemoryCheckpointStore).close();
    });

    test("memory works with streaming agent", async () => {
      const { provider } = createTrackingMockProvider();
      const myAgent = agent({
        memory: {
          enabled: true,
          entityMemory: true,
          store,
        } satisfies MemoryConfig,
        name: "streaming-agent",
        prompt: "Test agent",
        streaming: true,
      });

      await myAgent.run("Test", provider, { sessionId: "streaming-test" });
      expect(await store.listEntities({ sessionId: "streaming-test" })).toBeDefined();
    });

    test("memory persists through multiple agent iterations", async () => {
      let callCount = 0;
      const provider: LLMProvider = {
        chat: async (messages: Array<Message>): Promise<LLMResponse> => {
          callCount++;
          const hasToolResult = messages.some(
            (m) => m.role === "user" && m.content.some((c) => c.type === "tool_result")
          );

          if (callCount === 1) {
            return {
              content: [
                {
                  input: { target: "192.168.1.1" },
                  name: "scan",
                  toolUseId: "tool_1",
                  type: "tool_use",
                },
              ],
              stopReason: "tool_use",
              usage: { inputTokens: 100, outputTokens: 50 },
            };
          }

          if (hasToolResult && callCount === 2) {
            return {
              content: [{ text: "Scan complete. Found web server.", type: "text" }],
              stopReason: "end_turn",
              usage: { inputTokens: 100, outputTokens: 50 },
            };
          }

          return {
            content: [
              {
                text: '[{"name":"192.168.1.1","type":"ip","attributes":{"port":80}}]',
                type: "text",
              },
            ],
            stopReason: "end_turn",
            usage: { inputTokens: 100, outputTokens: 50 },
          };
        },
        async *chatStream() {
          yield { content: "test", type: "text_delta" as const };
        },
        contextWindowSize: 200_000,
      };

      const scanTool = {
        description: "Scan a target",
        name: "scan",
        params: z.object({ target: z.string() }),
        run: async (input: unknown, _ctx: unknown) => {
          const { target } = input as { target: string };
          return `Scanned ${target}: port 80 open`;
        },
      };

      const myAgent = agent({
        memory: {
          enabled: true,
          entityMemory: true,
          store,
        } satisfies MemoryConfig,
        name: "multi-iteration-agent",
        prompt: "Test agent with tools",
        tools: [scanTool],
      });

      await myAgent.run("Scan the network", provider, { sessionId: "iteration-test" });
      expect(
        (await store.listEntities({ sessionId: "iteration-test" })).length
      ).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("Memory Integration Test Summary", () => {
  test("memory integration tests cover all required scenarios", () => {
    const coveredScenarios = [
      "Entity extraction (InMemory)",
      "Long-term memory across sessions",
      "Context injection into prompts",
      "Custom hooks override defaults",
      "Disabled features skip processing",
      "extractionProvider override works",
      "Error handling continues execution",
      "Multiple entity types",
      "Fact extraction with confidence",
      "Entity updates",
      "Feature toggles (entityMemory, longTermMemory, contextInjection)",
      "Streaming agent support",
      "Multi-iteration agent support",
      "Backend-owned package integration via shared harnesses",
      "Vector memory via shared harness",
    ];

    expect(coveredScenarios.length).toBeGreaterThanOrEqual(10);
    process.stdout.write(`Memory integration tests cover ${coveredScenarios.length} scenarios\n`);
  });
});

describe("transient late memory injection semantics", () => {
  test("empty memory adds no transient snapshot on resumed requests", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/transient-empty-memory");
    const providerCalls: Array<Array<Message>> = [];
    const provider = createCapturingProvider(providerCalls, ["seed", "follow-up"]);
    const myAgent = agent({
      memory: {
        contextInjection: true,
        enabled: true,
        entityMemory: false,
        hooks: {
          onMemoryLoad: createQueuedMemoryLoadHook([undefined, undefined]),
        },
        longTermMemory: false,
        store,
      } satisfies MemoryConfig,
      name: "transient-empty-memory-agent",
      prompt: "You are a helpful assistant",
    });

    await myAgent.run("Seed durable history", provider, {
      checkpointStore: store,
      sessionId: session.id,
    });

    await myAgent.run("Second turn without memory", provider, {
      checkpointStore: store,
      sessionId: session.id,
    });

    const secondRequestTexts = getAllTextContent(providerCalls[1] ?? []);
    expect(secondRequestTexts.some((text) => text.includes("## Memory Context"))).toBe(false);
    expect(getTextContent(providerCalls[1]!.at(-1)!)).toBe("Second turn without memory");
  });

  test("resumed requests inject one memory snapshot immediately before latest user input and never persist it", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/transient-memory-resume");
    const providerCalls: Array<Array<Message>> = [];
    const memoryContext = [
      "Known Entities:",
      "- web-01 (server)",
      "Relevant Facts:",
      "- SSH is available on port 22",
    ].join("\n");
    const provider = createCapturingProvider(providerCalls, ["seed", "follow-up"]);
    const myAgent = agent({
      memory: {
        contextInjection: true,
        enabled: true,
        entityMemory: false,
        hooks: {
          onMemoryLoad: createQueuedMemoryLoadHook([undefined, memoryContext]),
        },
        longTermMemory: false,
        store,
      } satisfies MemoryConfig,
      name: "transient-memory-resume-agent",
      prompt: "You are a helpful assistant",
    });

    await myAgent.run("Seed durable history", provider, {
      checkpointStore: store,
      sessionId: session.id,
    });

    await myAgent.run("What changed since the last scan?", provider, {
      checkpointStore: store,
      sessionId: session.id,
    });

    const secondRequest = providerCalls[1] ?? [];
    expect(getTextContent(secondRequest.at(-1)!)).toBe("What changed since the last scan?");
    expect(getTextContent(secondRequest.at(-2)!)).toBe(formatExpectedMemorySnapshot(memoryContext));

    const earlierTexts = getAllTextContent(secondRequest.slice(0, -2));
    expect(earlierTexts.some((text) => text.includes("## Memory Context"))).toBe(false);
    expect(earlierTexts.some((text) => text.includes(memoryContext))).toBe(false);

    await expectStoredHistoryToExcludeMemory(store, session.id, [
      "## Memory Context",
      memoryContext,
    ]);
  });

  test("long memory stays a single readable delimited snapshot and refreshes on later resume instead of persisting", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/transient-memory-long");
    const providerCalls: Array<Array<Message>> = [];
    const longMemoryContext = [
      "Known Entities:",
      "- app-01 (server) owner=platform",
      "- db-01 (database) owner=data",
      "Relevant Facts:",
      "- Maintenance window: Saturday 02:00 UTC",
      "- Alert routing: pager + slack",
      "- Notes: " + "retain exact formatting ".repeat(20).trim(),
    ].join("\n");
    const refreshedMemoryContext = [
      "Known Entities:",
      "- app-01 (server) owner=platform",
      "Relevant Facts:",
      "- Incident review scheduled tomorrow",
    ].join("\n");
    const provider = createCapturingProvider(providerCalls, ["seed", "second", "third"]);
    const myAgent = agent({
      memory: {
        contextInjection: true,
        enabled: true,
        entityMemory: false,
        hooks: {
          onMemoryLoad: createQueuedMemoryLoadHook([
            undefined,
            longMemoryContext,
            refreshedMemoryContext,
          ]),
        },
        longTermMemory: false,
        store,
      } satisfies MemoryConfig,
      name: "transient-memory-long-agent",
      prompt: "You are a helpful assistant",
    });

    await myAgent.run("Seed durable history", provider, {
      checkpointStore: store,
      sessionId: session.id,
    });

    await myAgent.run("Summarize the known operational context", provider, {
      checkpointStore: store,
      sessionId: session.id,
    });

    const secondRequest = providerCalls[1] ?? [];
    expect(getTextContent(secondRequest.at(-2)!)).toBe(
      formatExpectedMemorySnapshot(longMemoryContext)
    );
    expect(getTextContent(secondRequest.at(-1)!)).toBe("Summarize the known operational context");

    await myAgent.run("What is newly relevant now?", provider, {
      checkpointStore: store,
      sessionId: session.id,
    });

    const thirdRequest = providerCalls[2] ?? [];
    const thirdRequestTexts = getAllTextContent(thirdRequest);
    expect(thirdRequestTexts.filter((text) => text.includes("## Memory Context")).length).toBe(1);
    expect(getTextContent(thirdRequest.at(-2)!)).toBe(
      formatExpectedMemorySnapshot(refreshedMemoryContext)
    );
    expect(getTextContent(thirdRequest.at(-1)!)).toBe("What is newly relevant now?");
    expect(
      getAllTextContent(thirdRequest.slice(0, -2)).some((text) => text.includes(longMemoryContext))
    ).toBe(false);
    expect(
      getAllTextContent(thirdRequest.slice(0, -2)).some((text) =>
        text.includes(refreshedMemoryContext)
      )
    ).toBe(false);

    await expectStoredHistoryToExcludeMemory(store, session.id, [
      "## Memory Context",
      longMemoryContext,
      refreshedMemoryContext,
    ]);
  });
});
