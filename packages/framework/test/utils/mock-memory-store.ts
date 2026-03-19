import { mock } from "bun:test";
import type { Entity, Fact, MemoryStoreOperations } from "../../src/memory/types";
import type { LLMProvider, LLMResponse } from "../../src/types";

export function createMockStore(
  overrides: Partial<MemoryStoreOperations> = {}
): MemoryStoreOperations {
  return {
    deleteEntity: mock(() => Promise.resolve()),
    deleteFact: mock(() => Promise.resolve()),
    getEntity: mock(() => Promise.resolve(null)),
    getFact: mock(() => Promise.resolve(null)),
    hasSemanticSearch: true,
    listEntities: mock(() => Promise.resolve([])),
    listFacts: mock(() => Promise.resolve([])),
    saveEntity: mock(() => Promise.resolve({} as Entity)),
    saveFact: mock(() => Promise.resolve({} as Fact)),
    searchEntitiesSemantic: mock(() => Promise.resolve([])),
    searchFactsSemantic: mock(() => Promise.resolve([])),
    updateEntity: mock(() => Promise.resolve()),
    ...overrides,
  };
}

export function createMockProvider(response: LLMResponse): LLMProvider {
  return {
    chat: mock(() => Promise.resolve(response)),
    chatStream: mock(async function* () {
      yield { content: "test", type: "text_delta" as const };
    }),
    contextWindowSize: 200_000,
  };
}

export const sampleEntity: Entity = {
  attributes: { role: "admin" },
  createdAt: Date.now(),
  id: "e1",
  name: "John",
  relationships: [],
  sessionId: "s1",
  type: "person",
  updatedAt: Date.now(),
};

export const sampleFact: Fact = {
  confidence: 0.9,
  content: "Server runs nginx",
  createdAt: Date.now(),
  id: "f1",
  workspaceId: "w1",
};
