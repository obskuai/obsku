import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type {
  Entity,
  MemoryHookContext,
  MemoryStore,
  MemoryStoreOperations,
} from "@obsku/framework";
import { agent } from "../../../src/agent";
import type { EmbeddingProvider } from "../../../src/embeddings/types";
import type { LLMProvider, LLMResponse, MemoryConfig, Message } from "../../../src/types";

/** Integration store: session management + entity/fact ops + semantic search */
export type IntegrationStore = MemoryStore &
  Pick<MemoryStoreOperations, "searchEntitiesSemantic" | "searchFactsSemantic">;

interface MockResponse {
  content?: string;
  toolInput?: Record<string, unknown>;
  toolName?: string;
  type: "text" | "tool_use";
}

export interface MemoryIntegrationOptions {
  cleanup?: (store: IntegrationStore) => Promise<void>;
  createStore: () => Promise<IntegrationStore> | IntegrationStore;
  description: string;
  hasSemanticSearch?: boolean;
}

export function createSequentialMockProvider(responses: Array<MockResponse>): LLMProvider {
  let callIndex = 0;
  return {
    chat: async (): Promise<LLMResponse> => {
      const responseConfig = responses[callIndex] ?? responses.at(-1)!;
      callIndex++;
      if (responseConfig.type === "tool_use") {
        return {
          content: [
            {
              input: responseConfig.toolInput ?? {},
              name: responseConfig.toolName!,
              toolUseId: `tool_${callIndex}`,
              type: "tool_use",
            },
          ],
          stopReason: "tool_use",
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      }
      return {
        content: [{ text: responseConfig.content ?? "", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
    async *chatStream() {
      yield { content: "test", type: "text_delta" as const };
      yield {
        stopReason: "end_turn",
        type: "message_end" as const,
        usage: { inputTokens: 10, outputTokens: 8 },
      };
    },
    contextWindowSize: 200_000,
  };
}

export function createTrackingMockProvider(): {
  calls: Array<Array<Message>>;
  provider: LLMProvider;
} {
  const calls: Array<Array<Message>> = [];
  let callCount = 0;
  const provider: LLMProvider = {
    chat: async (messages: Array<Message>): Promise<LLMResponse> => {
      calls.push([...messages]);
      callCount++;
      if (callCount === 1) {
        return {
          content: [{ text: "Found server at 192.168.1.1 running nginx", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      }
      if (callCount === 2) {
        return {
          content: [
            {
              text: '[{"name":"192.168.1.1","type":"ip","attributes":{"service":"nginx"}}]',
              type: "text",
            },
          ],
          stopReason: "end_turn",
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      }
      if (callCount === 3) {
        return {
          content: [{ text: "Network scan revealed web server", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      }
      return {
        content: [
          { text: '[{"content":"Server 192.168.1.1 runs nginx","confidence":0.95}]', type: "text" },
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
  return { calls, provider };
}

export async function ensureSession(store: IntegrationStore, sessionId: string): Promise<string> {
  const session = await store.createSession("/tmp/test", { title: sessionId });
  return session.id;
}

function createMockEmbeddingProvider(dimension = 3): EmbeddingProvider {
  const textToVector = (text: string): Array<number> => {
    const vector: Array<number> = Array.from({ length: dimension }).fill(0) as Array<number>;
    for (let i = 0; i < text.length; i++) {
      vector[i % dimension] += text.charCodeAt(i) / 1000;
    }
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return magnitude > 0 ? vector.map((v) => v / magnitude) : vector;
  };
  return {
    dimension,
    embed: async (text: string) => textToVector(text),
    embedBatch: async (texts: Array<string>) => texts.map(textToVector),
    modelName: "mock-embedding-model",
  };
}

export function runMemoryIntegrationTests(options: MemoryIntegrationOptions): void {
  describe(options.description, () => {
    let store: IntegrationStore;

    beforeEach(async () => {
      store = await options.createStore();
    });

    afterEach(async () => {
      await options.cleanup?.(store);
    });

    test("entity extraction and retrieval workflow", async () => {
      const sessionId = await ensureSession(store, `entity-test-${Date.now()}`);
      const { provider } = createTrackingMockProvider();
      const myAgent = agent({
        memory: {
          contextInjection: true,
          enabled: true,
          entityMemory: true,
          store,
        } satisfies MemoryConfig,
        name: "test-agent",
        prompt: "You are a network scanner",
      });
      await myAgent.run("Scan the network for web servers", provider, { sessionId });
      const entities = await store.listEntities({ sessionId });
      expect(entities.length).toBeGreaterThanOrEqual(1);
      const ipEntity = entities.find((e) => e.type === "ip");
      expect(ipEntity?.name).toBe("192.168.1.1");
      expect(ipEntity?.attributes).toEqual({ service: "nginx" });
    });

    test("long-term memory persists across sessions", async () => {
      const session1Id = await ensureSession(store, `session-1-${Date.now()}`);
      const session2Id = await ensureSession(store, `session-2-${Date.now()}`);
      let sessionCount = 0;
      const provider: LLMProvider = {
        chat: async (): Promise<LLMResponse> => {
          sessionCount++;
          if (sessionCount <= 2) {
            return sessionCount === 1
              ? {
                  content: [{ text: "Found domain example.com", type: "text" }],
                  stopReason: "end_turn",
                  usage: { inputTokens: 100, outputTokens: 50 },
                }
              : {
                  content: [
                    {
                      text: '[{"name":"example.com","type":"domain","attributes":{}}]',
                      type: "text",
                    },
                  ],
                  stopReason: "end_turn",
                  usage: { inputTokens: 100, outputTokens: 50 },
                };
          }
          if (sessionCount === 3) {
            return {
              content: [{ text: "Session summary", type: "text" }],
              stopReason: "end_turn",
              usage: { inputTokens: 100, outputTokens: 50 },
            };
          }
          return {
            content: [
              {
                text: '[{"content":"example.com is a test domain","confidence":0.9}]',
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
      const myAgent = agent({
        memory: {
          contextInjection: true,
          enabled: true,
          entityMemory: true,
          longTermMemory: true,
          store,
        },
        name: "test-agent",
        prompt: "Network scanner",
      });
      await myAgent.run("Find domains", provider, { sessionId: session1Id });
      expect((await store.listEntities({ sessionId: session1Id })).length).toBeGreaterThanOrEqual(
        1
      );
      sessionCount = 0;
      await myAgent.run("Continue scanning", provider, { sessionId: session2Id });
      expect((await store.listEntities({})).length).toBeGreaterThanOrEqual(1);
    });

    test("context injection into prompts", async () => {
      const sessionId = await ensureSession(store, `context-test-${Date.now()}`);
      await store.saveEntity({
        attributes: { os: "linux" },
        name: "pre-existing-server",
        relationships: [],
        sessionId,
        type: "server",
      });
      const receivedMessages: Array<Array<Message>> = [];
      const provider: LLMProvider = {
        chat: async (messages: Array<Message>) => {
          receivedMessages.push([...messages]);
          return {
            content: [{ text: "Acknowledged the server", type: "text" }],
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
        memory: { contextInjection: true, enabled: true, entityMemory: true, store },
        name: "test-agent",
        prompt: "You are a helpful assistant",
      });
      await myAgent.run("Check the server status", provider, { sessionId });
      expect(receivedMessages.length).toBeGreaterThan(0);
    });

    test("custom hooks override defaults", async () => {
      const sessionId = await ensureSession(store, `hooks-test-${Date.now()}`);
      const customLoadCalled = mock(() => {});
      const customExtractCalled = mock(() => {});
      const customSaveCalled = mock(() => {});
      const myAgent = agent({
        memory: {
          contextInjection: true,
          enabled: true,
          entityMemory: true,
          hooks: {
            onEntityExtract: async (_ctx: MemoryHookContext & { response: LLMResponse }) => {
              customExtractCalled();
              return [] as Array<Entity>;
            },
            onMemoryLoad: async (_ctx: MemoryHookContext) => {
              customLoadCalled();
              return { context: "Custom injected context", entities: [], facts: [] };
            },
            onMemorySave: async (_ctx: MemoryHookContext) => {
              customSaveCalled();
            },
          },
          longTermMemory: true,
          store,
        } satisfies MemoryConfig,
        name: "test-agent",
        prompt: "Test agent",
      });
      await myAgent.run(
        "Test input",
        createSequentialMockProvider([{ content: "Agent response", type: "text" }]),
        { sessionId }
      );
      expect(customLoadCalled).toHaveBeenCalled();
      expect(customExtractCalled).toHaveBeenCalled();
      expect(customSaveCalled).toHaveBeenCalled();
    });

    test("disabled entityMemory skips extraction", async () => {
      const sessionId = await ensureSession(store, `disabled-test-${Date.now()}`);
      let llmCallCount = 0;
      const provider: LLMProvider = {
        chat: async () => {
          llmCallCount++;
          return {
            content: [{ text: "Found server 10.0.0.1", type: "text" }],
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
        },
        name: "test-agent",
        prompt: "Test agent",
      });
      await myAgent.run("Test input", provider, { sessionId });
      expect(llmCallCount).toBe(1);
      expect((await store.listEntities({ sessionId })).length).toBe(0);
    });

    test("extractionProvider override works", async () => {
      const sessionId = await ensureSession(store, `extraction-test-${Date.now()}`);
      let mainProviderCalls = 0;
      let extractionProviderCalls = 0;
      const mainProvider: LLMProvider = {
        chat: async () => {
          mainProviderCalls++;
          return {
            content: [{ text: "Found IP 172.16.0.1", type: "text" }],
            stopReason: "end_turn",
            usage: { inputTokens: 100, outputTokens: 50 },
          };
        },
        async *chatStream() {
          yield { content: "test", type: "text_delta" as const };
        },
        contextWindowSize: 200_000,
      };
      const extractionProvider: LLMProvider = {
        chat: async () => {
          extractionProviderCalls++;
          return {
            content: [
              {
                text: '[{"name":"172.16.0.1","type":"ip","attributes":{"extracted":"true"}}]',
                type: "text",
              },
            ],
            stopReason: "end_turn",
            usage: { inputTokens: 50, outputTokens: 25 },
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
          entityMemory: true,
          extractionProvider,
          longTermMemory: false,
          store,
        },
        name: "test-agent",
        prompt: "Test agent",
      });
      await myAgent.run("Scan network", mainProvider, { sessionId });
      expect(mainProviderCalls).toBe(1);
      expect(extractionProviderCalls).toBeGreaterThanOrEqual(1);
      const entity = (await store.listEntities({ sessionId })).find((e) => e.name === "172.16.0.1");
      expect(entity?.attributes).toEqual({ extracted: "true" });
    });

    test("memory disabled completely skips all operations", async () => {
      const sessionId = await ensureSession(store, `disabled-full-${Date.now()}`);
      let llmCallCount = 0;
      const provider: LLMProvider = {
        chat: async () => {
          llmCallCount++;
          return {
            content: [{ text: "Response", type: "text" }],
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
        memory: { enabled: false, store },
        name: "test-agent",
        prompt: "Test agent",
      });
      await myAgent.run("Test input", provider, { sessionId });
      expect(llmCallCount).toBe(1);
      expect((await store.listEntities({ sessionId })).length).toBe(0);
    });

    test("error handling with onHookError=log continues execution", async () => {
      const sessionId = await ensureSession(store, `error-test-${Date.now()}`);
      const consoleSpy = spyOn(console, "warn").mockImplementation(() => {});
      const myAgent = agent({
        memory: {
          contextInjection: true,
          enabled: true,
          entityMemory: false,
          hooks: {
            onMemoryLoad: async () => {
              throw new Error("Load failed");
            },
          },
          longTermMemory: false,
          onHookError: "log",
          store,
        },
        name: "test-agent",
        prompt: "Test agent",
      });
      expect(
        await myAgent.run(
          "Test input",
          createSequentialMockProvider([{ content: "Agent response despite error", type: "text" }]),
          { sessionId }
        )
      ).toBeDefined();
      consoleSpy.mockRestore();
    });

    test("multiple entity types extracted correctly", async () => {
      const sessionId = await ensureSession(store, `multi-entity-${Date.now()}`);
      let callCount = 0;
      const provider: LLMProvider = {
        chat: async () => {
          callCount++;
          return callCount === 1
            ? {
                content: [{ text: "Found IP 192.168.1.1 and domain example.com", type: "text" }],
                stopReason: "end_turn",
                usage: { inputTokens: 100, outputTokens: 50 },
              }
            : {
                content: [
                  {
                    text: JSON.stringify([
                      { attributes: { port: 80 }, name: "192.168.1.1", type: "ip" },
                      { attributes: { resolved: "true" }, name: "example.com", type: "domain" },
                    ]),
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
      const myAgent = agent({
        memory: { enabled: true, entityMemory: true, longTermMemory: false, store },
        name: "test-agent",
        prompt: "Network scanner",
      });
      await myAgent.run("Scan everything", provider, { sessionId });
      const entities = await store.listEntities({ sessionId });
      expect(entities.filter((e) => e.type === "ip").length).toBeGreaterThanOrEqual(1);
      expect(entities.filter((e) => e.type === "domain").length).toBeGreaterThanOrEqual(1);
    });

    test("fact extraction stores facts with confidence", async () => {
      const sessionId = await ensureSession(store, `fact-test-${Date.now()}`);
      let callCount = 0;
      const provider: LLMProvider = {
        chat: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              content: [{ text: "The server is running CentOS", type: "text" }],
              stopReason: "end_turn",
              usage: { inputTokens: 100, outputTokens: 50 },
            };
          }
          if (callCount === 2) {
            return {
              content: [{ text: "[]", type: "text" }],
              stopReason: "end_turn",
              usage: { inputTokens: 100, outputTokens: 50 },
            };
          }
          if (callCount === 3) {
            return {
              content: [{ text: "Discovered OS information", type: "text" }],
              stopReason: "end_turn",
              usage: { inputTokens: 100, outputTokens: 50 },
            };
          }
          return {
            content: [
              {
                text: '[{"content":"Server runs CentOS operating system","confidence":0.85}]',
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
      const myAgent = agent({
        memory: { enabled: true, entityMemory: true, longTermMemory: true, store },
        name: "test-agent",
        prompt: "System analyzer",
      });
      await myAgent.run("Identify the OS", provider, { sessionId });
      const centOsFact = (await store.listFacts({})).find((f) => f.content.includes("CentOS"));
      expect(centOsFact?.confidence).toBe(0.85);
    });

    test("entity updates tracked correctly", async () => {
      const sessionId = await ensureSession(store, `update-test-${Date.now()}`);
      const entity = await store.saveEntity({
        attributes: { status: "unknown" },
        name: "target-server",
        relationships: [],
        sessionId,
        type: "server",
      });
      await new Promise((r) => setTimeout(r, 5));
      await store.updateEntity(entity.id, { attributes: { port: 443, status: "online" } });
      const updated = await store.getEntity(entity.id);
      expect(updated?.attributes).toEqual({ port: 443, status: "online" });
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(entity.updatedAt);
    });

    if (options.hasSemanticSearch) {
      describe("Vector Memory Integration", () => {
        let mockEmbeddingProvider: EmbeddingProvider;
        beforeEach(() => {
          mockEmbeddingProvider = createMockEmbeddingProvider(3);
        });

        test("full flow: save entity with embedding and search semantically", async () => {
          const sessionId = await ensureSession(store, `vector-test-${Date.now()}`);
          const { provider } = createTrackingMockProvider();
          const myAgent = agent({
            memory: {
              contextInjection: true,
              embeddingProvider: mockEmbeddingProvider,
              enabled: true,
              entityMemory: true,
              longTermMemory: true,
              store,
            },
            name: "vector-test-agent",
            prompt: "Network scanner with semantic memory",
          });
          await myAgent.run("Found server 192.168.1.1 running nginx web server", provider, {
            sessionId,
          });
          const entity = (await store.listEntities({ sessionId }))[0];
          expect(entity.embedding?.length).toBe(3);
          expect(
            (
              await store.searchEntitiesSemantic(
                await mockEmbeddingProvider.embed("web server nginx"),
                { topK: 5 }
              )
            ).length
          ).toBeGreaterThanOrEqual(1);
        });

        test("semantic search retrieves relevant entities by similarity", async () => {
          const sessionId = await ensureSession(store, `semantic-search-${Date.now()}`);
          await store.saveEntity({
            attributes: { port: 80, software: "nginx" },
            embedding: await mockEmbeddingProvider.embed("nginx web server http"),
            name: "web-server-nginx",
            relationships: [],
            sessionId,
            type: "server",
          });
          await store.saveEntity({
            attributes: { port: 5432, software: "postgresql" },
            embedding: await mockEmbeddingProvider.embed("postgresql database sql"),
            name: "database-postgres",
            relationships: [],
            sessionId,
            type: "database",
          });
          await store.saveEntity({
            attributes: { port: 6379, software: "redis" },
            embedding: await mockEmbeddingProvider.embed("redis cache in-memory"),
            name: "cache-redis",
            relationships: [],
            sessionId,
            type: "cache",
          });
          expect(
            (
              await store.searchEntitiesSemantic(
                await mockEmbeddingProvider.embed("http web server"),
                { topK: 3 }
              )
            ).find((e) => e.name === "web-server-nginx")
          ).toBeDefined();
          expect(
            (
              await store.searchEntitiesSemantic(
                await mockEmbeddingProvider.embed("sql database"),
                { topK: 3 }
              )
            ).find((e) => e.name === "database-postgres")
          ).toBeDefined();
        });

        test("semantic search with threshold filters low similarity", async () => {
          const sessionId = await ensureSession(store, `threshold-test-${Date.now()}`);
          await store.saveEntity({
            attributes: {},
            embedding: await mockEmbeddingProvider.embed("nginx web server"),
            name: "server-nginx",
            relationships: [],
            sessionId,
            type: "server",
          });
          await store.saveEntity({
            attributes: {},
            embedding: await mockEmbeddingProvider.embed("apache web server"),
            name: "server-apache",
            relationships: [],
            sessionId,
            type: "server",
          });
          expect(
            (
              await store.searchEntitiesSemantic(
                await mockEmbeddingProvider.embed("nginx configuration"),
                { threshold: 0.9, topK: 10 }
              )
            ).length
          ).toBeLessThanOrEqual(2);
        });

        test("facts are saved with embeddings and searchable semantically", async () => {
          await store.saveFact({
            confidence: 0.95,
            content: "The main web server runs nginx on port 443 with SSL enabled",
            embedding: await mockEmbeddingProvider.embed("nginx web server ssl https port 443"),
          });
          await store.saveFact({
            confidence: 0.9,
            content: "Database connection uses PostgreSQL with connection pooling",
            embedding: await mockEmbeddingProvider.embed("postgresql database connection pool"),
          });
          expect(
            (
              await store.searchFactsSemantic(
                await mockEmbeddingProvider.embed("https secure ssl"),
                { topK: 5 }
              )
            ).find((f) => f.content.includes("SSL"))
          ).toBeDefined();
          expect(
            (
              await store.searchFactsSemantic(
                await mockEmbeddingProvider.embed("postgres sql database"),
                { topK: 5 }
              )
            ).find((f) => f.content.includes("PostgreSQL"))
          ).toBeDefined();
        });

        test("semantic search respects sessionId filter", async () => {
          const session1 = await ensureSession(store, `session-1-${Date.now()}`);
          const session2 = await ensureSession(store, `session-2-${Date.now()}`);
          await store.saveEntity({
            attributes: {},
            embedding: await mockEmbeddingProvider.embed("nginx server"),
            name: "server-session1",
            relationships: [],
            sessionId: session1,
            type: "server",
          });
          await store.saveEntity({
            attributes: {},
            embedding: await mockEmbeddingProvider.embed("apache server"),
            name: "server-session2",
            relationships: [],
            sessionId: session2,
            type: "server",
          });
          const session1Results = await store.searchEntitiesSemantic(
            await mockEmbeddingProvider.embed("nginx"),
            { sessionId: session1, topK: 10 }
          );
          expect(session1Results.length).toBe(1);
          expect(session1Results[0].name).toBe("server-session1");
        });

        test("agent with embeddingProvider auto-generates embeddings for entities", async () => {
          const sessionId = await ensureSession(store, `auto-embed-${Date.now()}`);
          let callCount = 0;
          const provider: LLMProvider = {
            chat: async () => {
              callCount++;
              return callCount === 1
                ? {
                    content: [{ text: "Found API gateway at api.example.com", type: "text" }],
                    stopReason: "end_turn",
                    usage: { inputTokens: 100, outputTokens: 50 },
                  }
                : {
                    content: [
                      {
                        text: JSON.stringify([
                          {
                            attributes: { service: "api-gateway" },
                            name: "api.example.com",
                            type: "domain",
                          },
                        ]),
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
          const myAgent = agent({
            memory: {
              embeddingProvider: mockEmbeddingProvider,
              enabled: true,
              entityMemory: true,
              longTermMemory: false,
              store,
            },
            name: "auto-embed-agent",
            prompt: "API discovery agent",
          });
          await myAgent.run("Discover API endpoints", provider, { sessionId });
          const entities = await store.listEntities({ sessionId });
          expect(entities[0].name).toBe("api.example.com");
          expect(entities[0].embedding?.length).toBe(3);
        });

        test("agent with embeddingProvider auto-generates embeddings for facts", async () => {
          const sessionId = await ensureSession(store, `auto-embed-fact-${Date.now()}`);
          let callCount = 0;
          const provider: LLMProvider = {
            chat: async () => {
              callCount++;
              if (callCount === 1) {
                return {
                  content: [
                    { text: "The load balancer distributes traffic across 3 nodes", type: "text" },
                  ],
                  stopReason: "end_turn",
                  usage: { inputTokens: 100, outputTokens: 50 },
                };
              }
              if (callCount === 2) {
                return {
                  content: [{ text: "[]", type: "text" }],
                  stopReason: "end_turn",
                  usage: { inputTokens: 100, outputTokens: 50 },
                };
              }
              if (callCount === 3) {
                return {
                  content: [{ text: "Infrastructure overview", type: "text" }],
                  stopReason: "end_turn",
                  usage: { inputTokens: 100, outputTokens: 50 },
                };
              }
              return {
                content: [
                  {
                    text: JSON.stringify([
                      { confidence: 0.9, content: "Load balancer has 3 backend nodes" },
                    ]),
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
          const myAgent = agent({
            memory: {
              embeddingProvider: mockEmbeddingProvider,
              enabled: true,
              entityMemory: true,
              longTermMemory: true,
              store,
            },
            name: "auto-embed-fact-agent",
            prompt: "Infrastructure documentation agent",
          });
          await myAgent.run("Document infrastructure", provider, { sessionId });
          const fact = (await store.listFacts({})).find((f) =>
            f.content.toLowerCase().includes("load balancer")
          );
          expect(fact?.embedding?.length).toBe(3);
        });

        test("semantic search fallback when no embeddings match", async () => {
          const sessionId = await ensureSession(store, `fallback-test-${Date.now()}`);
          await store.saveEntity({
            attributes: { os: "windows" },
            name: "legacy-server",
            relationships: [],
            sessionId,
            type: "server",
          });
          expect(
            (
              await store.searchEntitiesSemantic(
                await mockEmbeddingProvider.embed("linux server"),
                { topK: 10 }
              )
            ).length
          ).toBe(0);
        });

        test("memory hooks use semantic search when embeddingProvider and input provided", async () => {
          const sessionId = await ensureSession(store, `semantic-hooks-${Date.now()}`);
          await store.saveEntity({
            attributes: { endpoint: "/v1/users" },
            embedding: await mockEmbeddingProvider.embed("REST API user endpoint json"),
            name: "target-api",
            relationships: [],
            sessionId,
            type: "api",
          });
          const receivedMessages: Array<Array<Message>> = [];
          const provider: LLMProvider = {
            chat: async (messages: Array<Message>) => {
              receivedMessages.push([...messages]);
              return {
                content: [{ text: "Processing API request", type: "text" }],
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
              contextInjection: true,
              embeddingProvider: mockEmbeddingProvider,
              enabled: true,
              entityMemory: true,
              longTermMemory: false,
              store,
            },
            name: "semantic-hook-agent",
            prompt: "API testing agent",
          });
          await myAgent.run("Tell me about the user API endpoint", provider, { sessionId });
          expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
        });
      });
    }
  });
}
