import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  buildMemoryHookContext,
  executeEntityExtract,
  executeMemoryLoad,
  executeMemorySave,
} from "../../src/agent/memory-integration";
import type { MemoryHookContext } from "../../src/memory/types";
import type { LLMProvider, LLMResponse, MemoryConfig, Message } from "../../src/types";
import {
  createMockProvider,
  createMockStore,
  sampleEntity,
  sampleFact,
} from "../utils/mock-memory-store";

describe("buildMemoryHookContext", () => {
  it("creates context with all required fields", () => {
    const store = createMockStore();
    const messages: Array<Message> = [{ content: [{ text: "Hello", type: "text" }], role: "user" }];
    const config: MemoryConfig = { enabled: true, store };

    const ctx = buildMemoryHookContext("session1", "testAgent", messages, config);

    expect(ctx.sessionId).toBe("session1");
    expect(ctx.agentName).toBe("testAgent");
    expect(ctx.messages).toBe(messages);
    expect(ctx.store).toBe(store);
    expect(ctx.workspaceId).toBeUndefined();
  });
});

describe("executeMemoryLoad", () => {
  it("returns null when memory disabled", async () => {
    const store = createMockStore();
    const config: MemoryConfig = { enabled: false, store };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    const result = await executeMemoryLoad(config, ctx);

    expect(result).toBeNull();
  });

  it("returns null when contextInjection disabled", async () => {
    const store = createMockStore();
    const config: MemoryConfig = { contextInjection: false, enabled: true, store };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    const result = await executeMemoryLoad(config, ctx);

    expect(result).toBeNull();
  });

  it("returns null when no store provided", async () => {
    const config: MemoryConfig = { contextInjection: true, enabled: true };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store: createMockStore(),
    };

    const result = await executeMemoryLoad(config, ctx);

    expect(result).toBeNull();
  });

  it("calls default hook and returns injection", async () => {
    const store = createMockStore({
      listEntities: mock(() => Promise.resolve([sampleEntity])),
      listFacts: mock(() => Promise.resolve([sampleFact])),
    });
    const config: MemoryConfig = { contextInjection: true, enabled: true, store };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
      workspaceId: "w1",
    };

    const result = await executeMemoryLoad(config, ctx);

    expect(result).not.toBeNull();
    expect(result?.entities).toContain(sampleEntity);
    expect(result?.facts).toContain(sampleFact);
    expect(result?.context).toContain("Known Entities:");
  });

  it("uses custom hook when provided", async () => {
    const store = createMockStore();
    const customHook = mock(() =>
      Promise.resolve({ context: "Custom context", entities: [], facts: [] })
    );
    const config: MemoryConfig = {
      contextInjection: true,
      enabled: true,
      hooks: { onMemoryLoad: customHook },
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    const result = await executeMemoryLoad(config, ctx);

    expect(customHook).toHaveBeenCalled();
    expect(result?.context).toBe("Custom context");
  });

  it("respects config limits passed to default hook", async () => {
    const store = createMockStore();
    const config: MemoryConfig = {
      contextInjection: true,
      enabled: true,
      maxContextLength: 500,
      maxEntitiesPerSession: 50,
      maxFactsToInject: 5,
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    await executeMemoryLoad(config, ctx);

    expect(store.listEntities).toHaveBeenCalledWith({
      limit: 50,
      sessionId: "s1",
    });
  });
});

describe("executeMemoryLoad error handling", () => {
  it("throws error when onHookError is throw", async () => {
    const store = createMockStore({
      listEntities: mock(() => Promise.reject(new Error("DB error"))),
    });
    const config: MemoryConfig = {
      contextInjection: true,
      enabled: true,
      onHookError: "throw",
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    await expect(executeMemoryLoad(config, ctx)).rejects.toThrow("DB error");
  });

  it("logs and returns null when onHookError is log", async () => {
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env.OBSKU_DEBUG = "1";
    const store = createMockStore({
      listEntities: mock(() => Promise.reject(new Error("DB error"))),
    });
    const config: MemoryConfig = {
      contextInjection: true,
      enabled: true,
      onHookError: "log",
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    const result = await executeMemoryLoad(config, ctx);

    expect(result).toBeNull();
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
    delete process.env.OBSKU_DEBUG;
  });

  it("ignores error and returns null when onHookError is ignore", async () => {
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    const store = createMockStore({
      listEntities: mock(() => Promise.reject(new Error("DB error"))),
    });
    const config: MemoryConfig = {
      contextInjection: true,
      enabled: true,
      onHookError: "ignore",
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    const result = await executeMemoryLoad(config, ctx);

    expect(result).toBeNull();
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("calls custom errorHandler when error occurs", async () => {
    const errorHandler = mock(() => {});
    const store = createMockStore({
      listEntities: mock(() => Promise.reject(new Error("DB error"))),
    });
    const config: MemoryConfig = {
      contextInjection: true,
      enabled: true,
      errorHandler,
      onHookError: "log",
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    await executeMemoryLoad(config, ctx);

    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error), "onMemoryLoad");
  });

  it("logs to debugLog on error (silent catch logging)", async () => {
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env.OBSKU_DEBUG = "1";
    const store = createMockStore({
      listEntities: mock(() => Promise.reject(new Error("DB error"))),
    });
    const config: MemoryConfig = {
      contextInjection: true,
      enabled: true,
      onHookError: "log",
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    await executeMemoryLoad(config, ctx);

    // Verify debugLog output (format: [obsku:debug] ...)
    const calls = stderrSpy.mock.calls;
    const telemetryCall = calls.find((call: Array<unknown>) =>
      String(call[0]).includes("[obsku:debug]")
    );
    expect(telemetryCall).toBeDefined();
    expect(String(telemetryCall![0])).toContain("onMemoryLoad");
    stderrSpy.mockRestore();
    delete process.env.OBSKU_DEBUG;
  });
});

describe("executeEntityExtract", () => {
  const mockResponse: LLMResponse = {
    content: [{ text: "Found example.com", type: "text" }],
    stopReason: "end_turn",
    usage: { inputTokens: 50, outputTokens: 30 },
  };

  it("returns empty array when memory disabled", async () => {
    const store = createMockStore();
    const provider = createMockProvider(mockResponse);
    const config: MemoryConfig = { enabled: false, store };
    const ctx: MemoryHookContext & { response: LLMResponse } = {
      agentName: "test",
      messages: [],
      response: mockResponse,
      sessionId: "s1",
      store,
    };

    const result = await executeEntityExtract(config, ctx, provider);

    expect(result).toEqual([]);
  });

  it("returns empty array when entityMemory disabled", async () => {
    const store = createMockStore();
    const provider = createMockProvider(mockResponse);
    const config: MemoryConfig = { enabled: true, entityMemory: false, store };
    const ctx: MemoryHookContext & { response: LLMResponse } = {
      agentName: "test",
      messages: [],
      response: mockResponse,
      sessionId: "s1",
      store,
    };

    const result = await executeEntityExtract(config, ctx, provider);

    expect(result).toEqual([]);
  });

  it("returns empty array when no store", async () => {
    const provider = createMockProvider(mockResponse);
    const config: MemoryConfig = { enabled: true };
    const ctx: MemoryHookContext & { response: LLMResponse } = {
      agentName: "test",
      messages: [],
      response: mockResponse,
      sessionId: "s1",
      store: createMockStore(),
    };

    const result = await executeEntityExtract(config, ctx, provider);

    expect(result).toEqual([]);
  });

  it("uses custom hook when provided", async () => {
    const store = createMockStore();
    const provider = createMockProvider(mockResponse);
    const customHook = mock(() => Promise.resolve([sampleEntity]));
    const config: MemoryConfig = {
      enabled: true,
      hooks: { onEntityExtract: customHook },
      store,
    };
    const ctx: MemoryHookContext & { response: LLMResponse } = {
      agentName: "test",
      messages: [],
      response: mockResponse,
      sessionId: "s1",
      store,
    };

    const result = await executeEntityExtract(config, ctx, provider);

    expect(customHook).toHaveBeenCalled();
    expect(result).toEqual([sampleEntity]);
  });

  it("uses extractionProvider when specified", async () => {
    const extractionResponse: LLMResponse = {
      content: [
        { text: '[{"name": "domain.com", "type": "domain", "attributes": {}}]', type: "text" },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    const store = createMockStore();
    const mainProvider = createMockProvider(mockResponse);
    const extractionProvider = createMockProvider(extractionResponse);
    const config: MemoryConfig = {
      enabled: true,
      extractionProvider,
      store,
    };
    const ctx: MemoryHookContext & { response: LLMResponse } = {
      agentName: "test",
      messages: [],
      response: mockResponse,
      sessionId: "s1",
      store,
    };

    await executeEntityExtract(config, ctx, mainProvider);

    expect(extractionProvider.chat).toHaveBeenCalled();
    expect(mainProvider.chat).not.toHaveBeenCalled();
  });

  it("uses main provider when no extractionProvider specified", async () => {
    const extractionResponse: LLMResponse = {
      content: [
        { text: '[{"name": "domain.com", "type": "domain", "attributes": {}}]', type: "text" },
      ],
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    const store = createMockStore();
    const mainProvider = createMockProvider(extractionResponse);
    const config: MemoryConfig = {
      enabled: true,
      store,
    };
    const ctx: MemoryHookContext & { response: LLMResponse } = {
      agentName: "test",
      messages: [],
      response: mockResponse,
      sessionId: "s1",
      store,
    };

    await executeEntityExtract(config, ctx, mainProvider);

    expect(mainProvider.chat).toHaveBeenCalled();
  });
});

describe("executeEntityExtract error handling", () => {
  const mockResponse: LLMResponse = {
    content: [{ text: "Test response", type: "text" }],
    stopReason: "end_turn",
    usage: { inputTokens: 50, outputTokens: 30 },
  };

  it("throws on error when onHookError is throw", async () => {
    const store = createMockStore();
    const provider: LLMProvider = {
      chat: mock(() => Promise.reject(new Error("LLM error"))),
      chatStream: mock(async function* () {}),
      contextWindowSize: 200_000,
    };
    const config: MemoryConfig = {
      enabled: true,
      onHookError: "throw",
      store,
    };
    const ctx: MemoryHookContext & { response: LLMResponse } = {
      agentName: "test",
      messages: [],
      response: mockResponse,
      sessionId: "s1",
      store,
    };

    await expect(executeEntityExtract(config, ctx, provider)).rejects.toThrow("LLM error");
  });

  it("returns empty array on error when onHookError is log", async () => {
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env.OBSKU_DEBUG = "1";
    const store = createMockStore();
    const provider: LLMProvider = {
      chat: mock(() => Promise.reject(new Error("LLM error"))),
      chatStream: mock(async function* () {}),
      contextWindowSize: 200_000,
    };
    const config: MemoryConfig = {
      enabled: true,
      onHookError: "log",
      store,
    };
    const ctx: MemoryHookContext & { response: LLMResponse } = {
      agentName: "test",
      messages: [],
      response: mockResponse,
      sessionId: "s1",
      store,
    };

    const result = await executeEntityExtract(config, ctx, provider);

    expect(result).toEqual([]);
    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
    delete process.env.OBSKU_DEBUG;
  });

  it("returns empty array without logging when onHookError is ignore", async () => {
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    const store = createMockStore();
    const provider: LLMProvider = {
      chat: mock(() => Promise.reject(new Error("LLM error"))),
      chatStream: mock(async function* () {}),
      contextWindowSize: 200_000,
    };
    const config: MemoryConfig = {
      enabled: true,
      onHookError: "ignore",
      store,
    };
    const ctx: MemoryHookContext & { response: LLMResponse } = {
      agentName: "test",
      messages: [],
      response: mockResponse,
      sessionId: "s1",
      store,
    };

    const result = await executeEntityExtract(config, ctx, provider);

    expect(result).toEqual([]);
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});

describe("executeMemorySave", () => {
  it("does nothing when memory disabled", async () => {
    const store = createMockStore();
    const provider = createMockProvider({
      content: [],
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    const config: MemoryConfig = { enabled: false, store };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    await executeMemorySave(config, ctx, provider);

    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("does nothing when longTermMemory disabled", async () => {
    const store = createMockStore();
    const provider = createMockProvider({
      content: [],
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    const config: MemoryConfig = { enabled: true, longTermMemory: false, store };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
      sessionId: "s1",
      store,
    };

    await executeMemorySave(config, ctx, provider);

    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("does nothing when no store", async () => {
    const provider = createMockProvider({
      content: [],
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    const config: MemoryConfig = { enabled: true };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store: createMockStore(),
    };

    await executeMemorySave(config, ctx, provider);

    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("uses custom hook when provided", async () => {
    const store = createMockStore();
    const provider = createMockProvider({
      content: [],
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    const customHook = mock(() => Promise.resolve());
    const config: MemoryConfig = {
      enabled: true,
      hooks: { onMemorySave: customHook },
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
      sessionId: "s1",
      store,
    };

    await executeMemorySave(config, ctx, provider);

    expect(customHook).toHaveBeenCalled();
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("uses extractionProvider when specified", async () => {
    const summaryResponse: LLMResponse = {
      content: [{ text: "Summary", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    const factResponse: LLMResponse = {
      content: [{ text: '[{"content": "fact", "confidence": 0.9}]', type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 80, outputTokens: 40 },
    };
    let callCount = 0;
    const extractionProvider: LLMProvider = {
      chat: mock(() => Promise.resolve(++callCount === 1 ? summaryResponse : factResponse)),
      chatStream: mock(async function* () {}),
      contextWindowSize: 200_000,
    };
    const mainProvider = createMockProvider({
      content: [],
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    const store = createMockStore();
    const config: MemoryConfig = {
      enabled: true,
      extractionProvider,
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
      sessionId: "s1",
      store,
    };

    await executeMemorySave(config, ctx, mainProvider);

    expect(extractionProvider.chat).toHaveBeenCalled();
    expect(mainProvider.chat).not.toHaveBeenCalled();
  });
});

describe("executeMemorySave error handling", () => {
  it("throws on error when onHookError is throw", async () => {
    const store = createMockStore();
    const provider: LLMProvider = {
      chat: mock(() => Promise.reject(new Error("LLM error"))),
      chatStream: mock(async function* () {}),
      contextWindowSize: 200_000,
    };
    const config: MemoryConfig = {
      enabled: true,
      onHookError: "throw",
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
      sessionId: "s1",
      store,
    };

    await expect(executeMemorySave(config, ctx, provider)).rejects.toThrow("LLM error");
  });

  it("logs and continues on error when onHookError is log", async () => {
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env.OBSKU_DEBUG = "1";
    const store = createMockStore();
    const provider: LLMProvider = {
      chat: mock(() => Promise.reject(new Error("LLM error"))),
      chatStream: mock(async function* () {}),
      contextWindowSize: 200_000,
    };
    const config: MemoryConfig = {
      enabled: true,
      onHookError: "log",
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
      sessionId: "s1",
      store,
    };

    await executeMemorySave(config, ctx, provider);

    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
    delete process.env.OBSKU_DEBUG;
  });

  it("calls custom errorHandler on error", async () => {
    const errorHandler = mock(() => {});
    const store = createMockStore();
    const provider: LLMProvider = {
      chat: mock(() => Promise.reject(new Error("LLM error"))),
      chatStream: mock(async function* () {}),
      contextWindowSize: 200_000,
    };
    const config: MemoryConfig = {
      enabled: true,
      errorHandler,
      onHookError: "log",
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
      sessionId: "s1",
      store,
    };

    await executeMemorySave(config, ctx, provider);

    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error), "onMemorySave");
  });

  it("ignores error without logging when onHookError is ignore", async () => {
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    const store = createMockStore();
    const provider: LLMProvider = {
      chat: mock(() => Promise.reject(new Error("LLM error"))),
      chatStream: mock(async function* () {}),
      contextWindowSize: 200_000,
    };
    const config: MemoryConfig = {
      enabled: true,
      onHookError: "ignore",
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
      sessionId: "s1",
      store,
    };

    await executeMemorySave(config, ctx, provider);

    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});

describe("feature toggles", () => {
  it("entityMemory defaults to enabled when not specified", async () => {
    const extractionResponse: LLMResponse = {
      content: [{ text: '[{"name": "test", "type": "entity", "attributes": {}}]', type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    const store = createMockStore();
    const provider = createMockProvider(extractionResponse);
    const config: MemoryConfig = {
      enabled: true,
      store,
    };
    const ctx: MemoryHookContext & { response: LLMResponse } = {
      agentName: "test",
      messages: [],
      response: {
        content: [{ text: "Test response", type: "text" }],
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 30 },
      },
      sessionId: "s1",
      store,
    };

    await executeEntityExtract(config, ctx, provider);

    expect(provider.chat).toHaveBeenCalled();
  });

  it("longTermMemory defaults to enabled when not specified", async () => {
    const summaryResponse: LLMResponse = {
      content: [{ text: "Summary", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    const factResponse: LLMResponse = {
      content: [{ text: "[]", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 80, outputTokens: 40 },
    };
    let callCount = 0;
    const provider: LLMProvider = {
      chat: mock(() => Promise.resolve(++callCount === 1 ? summaryResponse : factResponse)),
      chatStream: mock(async function* () {}),
      contextWindowSize: 200_000,
    };
    const store = createMockStore();
    const config: MemoryConfig = {
      enabled: true,
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
      sessionId: "s1",
      store,
    };

    await executeMemorySave(config, ctx, provider);

    expect(provider.chat).toHaveBeenCalled();
  });

  it("contextInjection defaults to enabled when not specified", async () => {
    const store = createMockStore({
      listEntities: mock(() => Promise.resolve([sampleEntity])),
    });
    const config: MemoryConfig = {
      enabled: true,
      store,
    };
    const ctx: MemoryHookContext = {
      agentName: "test",
      messages: [],
      sessionId: "s1",
      store,
    };

    const result = await executeMemoryLoad(config, ctx);

    expect(result).not.toBeNull();
    expect(store.listEntities).toHaveBeenCalled();
  });
});
