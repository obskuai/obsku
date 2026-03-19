import { describe, expect, it, mock } from "bun:test";
import type { EmbeddingProvider } from "../../src/embeddings/types";
import {
  defaultOnEntityExtract,
  defaultOnMemoryLoad,
  defaultOnMemorySave,
} from "../../src/memory/hooks";
import type { Entity, Fact, MemoryHookContext } from "../../src/memory/types";
import type { LLMProvider, LLMResponse, Message } from "../../src/types";
import {
  createMockProvider,
  createMockStore,
  sampleEntity,
  sampleFact,
} from "../utils/mock-memory-store";

describe("defaultOnMemoryLoad", () => {
  it("loads entities from session", async () => {
    const store = createMockStore({
      listEntities: mock(() => Promise.resolve([sampleEntity])),
    });

    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    const result = await defaultOnMemoryLoad(ctx);

    expect(result.entities).toEqual([sampleEntity]);
    expect(store.listEntities).toHaveBeenCalledWith({
      limit: 100,
      sessionId: "s1",
    });
  });

  it("loads facts from workspace", async () => {
    const store = createMockStore({
      listFacts: mock(() => Promise.resolve([sampleFact])),
    });

    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
      workspaceId: "w1",
    };

    const result = await defaultOnMemoryLoad(ctx);

    expect(result.facts).toEqual([sampleFact]);
    expect(store.listFacts).toHaveBeenCalledWith({
      limit: 10,
      minConfidence: 0.7,
      workspaceId: "w1",
    });
  });

  it("returns empty facts when no workspaceId", async () => {
    const store = createMockStore();

    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    const result = await defaultOnMemoryLoad(ctx);

    expect(result.facts).toEqual([]);
    expect(store.listFacts).not.toHaveBeenCalled();
  });

  it("builds context string from entities and facts", async () => {
    const store = createMockStore({
      listEntities: mock(() => Promise.resolve([sampleEntity])),
      listFacts: mock(() => Promise.resolve([sampleFact])),
    });

    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
      workspaceId: "w1",
    };

    const result = await defaultOnMemoryLoad(ctx);

    expect(result.context).toContain("Known Entities:");
    expect(result.context).toContain("John (person)");
    expect(result.context).toContain("Relevant Facts:");
    expect(result.context).toContain("Server runs nginx");
  });

  it("respects custom config limits", async () => {
    const store = createMockStore();

    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
      workspaceId: "w1",
    };

    await defaultOnMemoryLoad(ctx, {
      maxContextLength: 500,
      maxEntitiesPerSession: 50,
      maxFactsToInject: 5,
    });

    expect(store.listEntities).toHaveBeenCalledWith({
      limit: 50,
      sessionId: "s1",
    });
    expect(store.listFacts).toHaveBeenCalledWith({
      limit: 5,
      minConfidence: 0.7,
      workspaceId: "w1",
    });
  });

  it("loads workspace entities when session has fewer than limit", async () => {
    const sessionEntity: Entity = { ...sampleEntity, id: "e1" };
    const workspaceEntity: Entity = { ...sampleEntity, id: "e2", name: "Jane" };

    const store = createMockStore({
      listEntities: mock(async (opts) => {
        if (opts.sessionId) {
          return [sessionEntity];
        }
        if (opts.workspaceId) {
          return [workspaceEntity];
        }
        return [];
      }),
    });

    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
      workspaceId: "w1",
    };

    const result = await defaultOnMemoryLoad(ctx);

    expect(result.entities).toHaveLength(2);
    expect(result.entities?.map((e) => e.name)).toContain("John");
    expect(result.entities?.map((e) => e.name)).toContain("Jane");
  });

  it("returns undefined context when no entities or facts", async () => {
    const store = createMockStore();

    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    const result = await defaultOnMemoryLoad(ctx);

    expect(result.context).toBeUndefined();
  });
});

describe("defaultOnEntityExtract", () => {
  it("extracts entities from LLM response", async () => {
    const extractionResponse: LLMResponse = {
      content: [
        {
          text: '[{"name": "example.com", "type": "domain", "attributes": {}}]',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    };

    const provider = createMockProvider(extractionResponse);
    const store = createMockStore();

    const agentResponse: LLMResponse = {
      content: [{ text: "I found example.com in the scan.", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 50, outputTokens: 30 },
    };

    const ctx: MemoryHookContext & { response: LLMResponse } = {
      agentName: "test",
      messages: [],
      response: agentResponse,
      sessionId: "s1",
      store,
      workspaceId: "w1",
    };

    const entities = await defaultOnEntityExtract(ctx, provider);

    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe("example.com");
    expect(entities[0].sessionId).toBe("s1");
    expect(entities[0].workspaceId).toBe("w1");
    expect(store.saveEntity).toHaveBeenCalled();
  });

  it("returns empty array when response has no text", async () => {
    const provider = createMockProvider({
      content: [],
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    const store = createMockStore();

    const ctx: MemoryHookContext & { response: LLMResponse } = {
      agentName: "test",
      messages: [],
      response: {
        content: [{ input: {}, name: "test", toolUseId: "123", type: "tool_use" }],
        stopReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      sessionId: "s1",
      store,
    };

    const entities = await defaultOnEntityExtract(ctx, provider);

    expect(entities).toEqual([]);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("saves extracted entities to store", async () => {
    const extractionResponse: LLMResponse = {
      content: [
        {
          text: '[{"name": "user1", "type": "person", "attributes": {"role": "admin"}}]',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    };

    const provider = createMockProvider(extractionResponse);
    const store = createMockStore();

    const ctx: MemoryHookContext & { response: LLMResponse } = {
      agentName: "test",
      messages: [],
      response: {
        content: [{ text: "Found user1 with admin role", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 30, outputTokens: 20 },
      },
      sessionId: "s1",
      store,
    };

    await defaultOnEntityExtract(ctx, provider);

    expect(store.saveEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: { role: "admin" },
        name: "user1",
        sessionId: "s1",
        type: "person",
      })
    );
  });

  it("handles malformed LLM extraction response gracefully", async () => {
    const extractionResponse: LLMResponse = {
      content: [{ text: "This is not valid JSON", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    };

    const provider = createMockProvider(extractionResponse);
    const store = createMockStore();

    const ctx: MemoryHookContext & { response: LLMResponse } = {
      agentName: "test",
      messages: [],
      response: {
        content: [{ text: "Some response", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 30, outputTokens: 20 },
      },
      sessionId: "s1",
      store,
    };

    const entities = await defaultOnEntityExtract(ctx, provider);

    expect(entities).toEqual([]);
    expect(store.saveEntity).not.toHaveBeenCalled();
  });
});

describe("defaultOnMemorySave", () => {
  it("summarizes conversation and extracts facts", async () => {
    const summaryResponse: LLMResponse = {
      content: [{ text: "The user scanned example.com and found open ports.", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    };

    const factResponse: LLMResponse = {
      content: [
        {
          text: '[{"content": "example.com has open ports", "confidence": 0.9}]',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 80, outputTokens: 40 },
    };

    let callCount = 0;
    const provider: LLMProvider = {
      chat: mock(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? summaryResponse : factResponse);
      }),
      chatStream: mock(async function* () {
        yield { content: "test", type: "text_delta" as const };
      }),
      contextWindowSize: 200_000,
    };

    const store = createMockStore();

    const messages: Array<Message> = [
      { content: [{ text: "Scan example.com", type: "text" }], role: "user" },
      { content: [{ text: "Found open ports", type: "text" }], role: "assistant" },
    ];

    const ctx: MemoryHookContext = {
      agentName: "test",
      messages,
      sessionId: "s1",
      store,
      workspaceId: "w1",
    };

    await defaultOnMemorySave(ctx, provider);

    expect(provider.chat).toHaveBeenCalledTimes(2);
    expect(store.saveFact).toHaveBeenCalledWith(
      expect.objectContaining({
        confidence: 0.9,
        content: "example.com has open ports",
        sourceSessionId: "s1",
        workspaceId: "w1",
      })
    );
  });

  it("does nothing when no messages", async () => {
    const provider = createMockProvider({
      content: [],
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    const store = createMockStore();

    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    await defaultOnMemorySave(ctx, provider);

    expect(provider.chat).not.toHaveBeenCalled();
    expect(store.saveFact).not.toHaveBeenCalled();
  });

  it("handles empty summary response", async () => {
    const provider = createMockProvider({
      content: [],
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 0 },
    });
    const store = createMockStore();

    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
      sessionId: "s1",
      store,
    };

    await defaultOnMemorySave(ctx, provider);

    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(store.saveFact).not.toHaveBeenCalled();
  });

  it("saves multiple facts", async () => {
    const summaryResponse: LLMResponse = {
      content: [{ text: "Summary of conversation", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    };

    const factResponse: LLMResponse = {
      content: [
        {
          text: '[{"content": "Fact 1", "confidence": 0.8}, {"content": "Fact 2", "confidence": 0.9}]',
          type: "text",
        },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 80, outputTokens: 40 },
    };

    let callCount = 0;
    const provider: LLMProvider = {
      chat: mock(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? summaryResponse : factResponse);
      }),
      chatStream: mock(async function* () {
        yield { content: "test", type: "text_delta" as const };
      }),
      contextWindowSize: 200_000,
    };

    const store = createMockStore();

    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
      sessionId: "s1",
      store,
    };

    await defaultOnMemorySave(ctx, provider);

    expect(store.saveFact).toHaveBeenCalledTimes(2);
  });
});

describe("embedding integration", () => {
  function createMockEmbeddingProvider(): EmbeddingProvider {
    let embedCount = 0;
    return {
      dimension: 3,
      embed: mock((_text: string) => {
        embedCount++;
        return Promise.resolve([0.1 * embedCount, 0.2 * embedCount, 0.3 * embedCount]);
      }),
      embedBatch: mock((texts: Array<string>) => {
        return Promise.resolve(texts.map((_, i) => [0.1 * (i + 1), 0.2 * (i + 1), 0.3 * (i + 1)]));
      }),
      modelName: "mock-embedding",
    };
  }

  describe("defaultOnEntityExtract with embeddings", () => {
    it("generates embeddings when embeddingProvider is configured", async () => {
      const extractionResponse: LLMResponse = {
        content: [
          {
            text: '[{"name": "example.com", "type": "domain", "attributes": {"status": "active"}}]',
            type: "text",
          },
        ],
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
      };

      const provider = createMockProvider(extractionResponse);
      const embeddingProvider = createMockEmbeddingProvider();
      const store = createMockStore();

      const agentResponse: LLMResponse = {
        content: [{ text: "I found example.com in the scan.", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 30 },
      };

      const ctx: MemoryHookContext & { response: LLMResponse } = {
        agentName: "test",
        embeddingProvider,
        messages: [],
        response: agentResponse,
        sessionId: "s1",
        store,
        workspaceId: "w1",
      };

      await defaultOnEntityExtract(ctx, provider);

      expect(embeddingProvider.embed).toHaveBeenCalled();
      expect(store.saveEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          embedding: expect.any(Array),
          name: "example.com",
          type: "domain",
        })
      );
    });

    it("does not generate embeddings when embeddingProvider is not configured", async () => {
      const extractionResponse: LLMResponse = {
        content: [
          {
            text: '[{"name": "example.com", "type": "domain", "attributes": {}}]',
            type: "text",
          },
        ],
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
      };

      const provider = createMockProvider(extractionResponse);
      const store = createMockStore();

      const ctx: MemoryHookContext & { response: LLMResponse } = {
        agentName: "test",
        messages: [],
        response: {
          content: [{ text: "I found example.com", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 50, outputTokens: 30 },
        },
        sessionId: "s1",
        store,
      };

      await defaultOnEntityExtract(ctx, provider);

      expect(store.saveEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          embedding: undefined,
          name: "example.com",
        })
      );
    });
  });

  describe("defaultOnMemorySave with embeddings", () => {
    it("generates embeddings for facts when embeddingProvider is configured", async () => {
      const summaryResponse: LLMResponse = {
        content: [{ text: "The user scanned example.com and found open ports.", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
      };

      const factResponse: LLMResponse = {
        content: [
          {
            text: '[{"content": "example.com has open ports", "confidence": 0.9}]',
            type: "text",
          },
        ],
        stopReason: "end_turn",
        usage: { inputTokens: 80, outputTokens: 40 },
      };

      let callCount = 0;
      const provider: LLMProvider = {
        chat: mock(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? summaryResponse : factResponse);
        }),
        chatStream: mock(async function* () {
          yield { content: "test", type: "text_delta" as const };
        }),
        contextWindowSize: 200_000,
      };

      const embeddingProvider = createMockEmbeddingProvider();
      const store = createMockStore();

      const messages: Array<Message> = [
        { content: [{ text: "Scan example.com", type: "text" }], role: "user" },
        { content: [{ text: "Found open ports", type: "text" }], role: "assistant" },
      ];

      const ctx: MemoryHookContext = {
        agentName: "test",
        embeddingProvider,
        messages,
        sessionId: "s1",
        store,
        workspaceId: "w1",
      };

      await defaultOnMemorySave(ctx, provider);

      expect(embeddingProvider.embed).toHaveBeenCalledWith("example.com has open ports");
      expect(store.saveFact).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "example.com has open ports",
          embedding: expect.any(Array),
        })
      );
    });

    it("does not generate embeddings when embeddingProvider is not configured", async () => {
      const summaryResponse: LLMResponse = {
        content: [{ text: "Summary", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
      };

      const factResponse: LLMResponse = {
        content: [
          {
            text: '[{"content": "Test fact", "confidence": 0.9}]',
            type: "text",
          },
        ],
        stopReason: "end_turn",
        usage: { inputTokens: 80, outputTokens: 40 },
      };

      let callCount = 0;
      const provider: LLMProvider = {
        chat: mock(() => {
          callCount++;
          return Promise.resolve(callCount === 1 ? summaryResponse : factResponse);
        }),
        chatStream: mock(async function* () {
          yield { content: "test", type: "text_delta" as const };
        }),
        contextWindowSize: 200_000,
      };

      const store = createMockStore();

      const ctx: MemoryHookContext = {
        agentName: "test",
        messages: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
        sessionId: "s1",
        store,
        workspaceId: "w1",
      };

      await defaultOnMemorySave(ctx, provider);

      expect(store.saveFact).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Test fact",
          embedding: undefined,
        })
      );
    });
  });

  describe("memory load semantic fallback", () => {
    it("uses semantic search when embeddingProvider and input are provided", async () => {
      const semanticEntity: Entity = {
        attributes: {},
        createdAt: Date.now(),
        embedding: [0.1, 0.2, 0.3],
        id: "e1",
        name: "example.com",
        relationships: [],
        sessionId: "s1",
        type: "domain",
        updatedAt: Date.now(),
      };

      const embeddingProvider = createMockEmbeddingProvider();
      const store = createMockStore({
        searchEntitiesSemantic: mock(() => Promise.resolve([semanticEntity])),
        searchFactsSemantic: mock(() => Promise.resolve([])),
      });

      const ctx: MemoryHookContext = {
        agentName: "test",
        embeddingProvider,
        input: "find domains",
        messages: [],
        sessionId: "s1",
        store,
        workspaceId: "w1",
      };

      const result = await defaultOnMemoryLoad(ctx);

      expect(embeddingProvider.embed).toHaveBeenCalledWith("find domains");
      expect(store.searchEntitiesSemantic).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          sessionId: "s1",
          threshold: 0.7,
          topK: 100,
          workspaceId: "w1",
        })
      );
      expect(result.entities).toEqual([semanticEntity]);
    });

    it("falls back to listEntities when semantic search returns no results", async () => {
      const embeddingProvider = createMockEmbeddingProvider();
      const store = createMockStore({
        listEntities: mock(() =>
          Promise.resolve([{ ...sampleEntity, id: "e1", name: "fallback-entity" }])
        ),
        searchEntitiesSemantic: mock(() => Promise.resolve([])),
        searchFactsSemantic: mock(() => Promise.resolve([])),
      });

      const ctx: MemoryHookContext = {
        agentName: "test",
        embeddingProvider,
        input: "query",
        messages: [],
        sessionId: "s1",
        store,
        workspaceId: "w1",
      };

      const result = await defaultOnMemoryLoad(ctx);

      expect(store.searchEntitiesSemantic).toHaveBeenCalled();
      expect(store.listEntities).toHaveBeenCalled();
      expect(result.entities?.[0].name).toBe("fallback-entity");
    });

    it("skips semantic entity search when store capability is unsupported", async () => {
      const embeddingProvider = createMockEmbeddingProvider();
      const store = createMockStore({
        hasSemanticSearch: false,
        listEntities: mock(() =>
          Promise.resolve([{ ...sampleEntity, id: "e1", name: "capability-fallback-entity" }])
        ),
        searchEntitiesSemantic: mock(() =>
          Promise.reject(new Error("should not call semantic entity search"))
        ),
      });

      const ctx: MemoryHookContext = {
        agentName: "test",
        embeddingProvider,
        input: "query",
        messages: [],
        sessionId: "s1",
        store,
        workspaceId: "w1",
      };

      const result = await defaultOnMemoryLoad(ctx);

      expect(store.searchEntitiesSemantic).not.toHaveBeenCalled();
      expect(store.listEntities).toHaveBeenCalled();
      expect(result.entities?.[0].name).toBe("capability-fallback-entity");
    });

    it("uses regular list when embeddingProvider is not configured", async () => {
      const store = createMockStore({
        listEntities: mock(() => Promise.resolve([sampleEntity])),
      });

      const ctx: MemoryHookContext = {
        agentName: "test",
        input: "query without provider",
        messages: [],
        sessionId: "s1",
        store,
        workspaceId: "w1",
      };

      const result = await defaultOnMemoryLoad(ctx);

      expect(store.listEntities).toHaveBeenCalledWith({
        limit: 100,
        sessionId: "s1",
      });
      expect(store.searchEntitiesSemantic).not.toHaveBeenCalled();
      expect(result.entities).toEqual([sampleEntity]);
    });

    it("uses semantic search for facts when embeddingProvider and input are provided", async () => {
      const semanticFact: Fact = {
        confidence: 0.9,
        content: "example.com runs nginx",
        createdAt: Date.now(),
        embedding: [0.1, 0.2, 0.3],
        id: "f1",
        workspaceId: "w1",
      };

      const embeddingProvider = createMockEmbeddingProvider();
      const store = createMockStore({
        listEntities: mock(() => Promise.resolve([])),
        searchEntitiesSemantic: mock(() => Promise.resolve([])),
        searchFactsSemantic: mock(() => Promise.resolve([semanticFact])),
      });

      const ctx: MemoryHookContext = {
        agentName: "test",
        embeddingProvider,
        input: "web server",
        messages: [],
        sessionId: "s1",
        store,
        workspaceId: "w1",
      };

      const result = await defaultOnMemoryLoad(ctx);

      expect(embeddingProvider.embed).toHaveBeenCalledWith("web server");
      expect(store.searchFactsSemantic).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          threshold: 0.7,
          topK: 10,
          workspaceId: "w1",
        })
      );
      expect(result.facts).toEqual([semanticFact]);
    });

    it("falls back to listFacts when semantic search returns no results", async () => {
      const embeddingProvider = createMockEmbeddingProvider();
      const store = createMockStore({
        listEntities: mock(() => Promise.resolve([])),
        listFacts: mock(() =>
          Promise.resolve([{ ...sampleFact, content: "fallback fact", id: "f1" }])
        ),
        searchEntitiesSemantic: mock(() => Promise.resolve([])),
        searchFactsSemantic: mock(() => Promise.resolve([])),
      });

      const ctx: MemoryHookContext = {
        agentName: "test",
        embeddingProvider,
        input: "query",
        messages: [],
        sessionId: "s1",
        store,
        workspaceId: "w1",
      };

      const result = await defaultOnMemoryLoad(ctx);

      expect(store.searchFactsSemantic).toHaveBeenCalled();
      expect(store.listFacts).toHaveBeenCalled();
      expect(result.facts?.[0].content).toBe("fallback fact");
    });

    it("skips semantic fact search when store capability is unsupported", async () => {
      const embeddingProvider = createMockEmbeddingProvider();
      const store = createMockStore({
        hasSemanticSearch: false,
        listEntities: mock(() => Promise.resolve([])),
        listFacts: mock(() =>
          Promise.resolve([{ ...sampleFact, content: "capability fallback fact", id: "f1" }])
        ),
        searchFactsSemantic: mock(() =>
          Promise.reject(new Error("should not call semantic fact search"))
        ),
      });

      const ctx: MemoryHookContext = {
        agentName: "test",
        embeddingProvider,
        input: "query",
        messages: [],
        sessionId: "s1",
        store,
        workspaceId: "w1",
      };

      const result = await defaultOnMemoryLoad(ctx);

      expect(store.searchFactsSemantic).not.toHaveBeenCalled();
      expect(store.listFacts).toHaveBeenCalled();
      expect(result.facts?.[0].content).toBe("capability fallback fact");
    });

    it("single embedding per load: calls embed exactly once even when both entities and facts use semantic search", async () => {
      const semanticEntity: Entity = {
        attributes: {},
        createdAt: Date.now(),
        embedding: [0.1, 0.2, 0.3],
        id: "e1",
        name: "example.com",
        relationships: [],
        sessionId: "s1",
        type: "domain",
        updatedAt: Date.now(),
      };
      const semanticFact: Fact = {
        confidence: 0.9,
        content: "example.com runs nginx",
        createdAt: Date.now(),
        embedding: [0.1, 0.2, 0.3],
        id: "f1",
        workspaceId: "w1",
      };

      const embeddingProvider = createMockEmbeddingProvider();
      const store = createMockStore({
        searchEntitiesSemantic: mock(() => Promise.resolve([semanticEntity])),
        searchFactsSemantic: mock(() => Promise.resolve([semanticFact])),
      });

      const ctx: MemoryHookContext = {
        agentName: "test",
        embeddingProvider,
        input: "find domains",
        messages: [],
        sessionId: "s1",
        store,
        workspaceId: "w1",
      };

      const result = await defaultOnMemoryLoad(ctx);

      // embed must be called exactly once — reused for both entity and fact queries
      expect(embeddingProvider.embed).toHaveBeenCalledTimes(1);
      expect(embeddingProvider.embed).toHaveBeenCalledWith("find domains");
      expect(result.entities).toEqual([semanticEntity]);
      expect(result.facts).toEqual([semanticFact]);
    });
  });
});
