import { describe, expect, it } from "bun:test";
import { InMemoryCheckpointStore } from "../../src/checkpoint/in-memory";
import { runMemoryTests } from "./shared/memory-tests";

runMemoryTests({
  createStore: () => ({ store: new InMemoryCheckpointStore() }),
  description: "InMemoryCheckpointStore - MemoryStore Implementation",
  hasSemanticSearch: true,
});

describe("InMemoryCheckpointStore - Memory Backend Specific", () => {
  describe("getEntity - copy safety", () => {
    it("should return copy of entity (not reference)", async () => {
      const store = new InMemoryCheckpointStore();
      const saved = await store.saveEntity({
        attributes: { key: "value" },
        name: "example.com",
        relationships: [],
        sessionId: "session-1",
        type: "domain",
      });

      const retrieved1 = await store.getEntity(saved.id);
      const retrieved2 = await store.getEntity(saved.id);

      retrieved1!.attributes.key = "modified";

      expect(retrieved2!.attributes.key).toBe("value");
    });
  });

  describe("getFact - copy safety", () => {
    it("should return copy of fact (not reference)", async () => {
      const store = new InMemoryCheckpointStore();
      const saved = await store.saveFact({
        confidence: 0.9,
        content: "Test fact",
      });

      const retrieved1 = await store.getFact(saved.id);
      const retrieved2 = await store.getFact(saved.id);

      retrieved1!.confidence = 0.5;

      expect(retrieved2!.confidence).toBe(0.9);
    });
  });

  describe("close() cleanup", () => {
    it("should clear all entities and facts on close", async () => {
      const store = new InMemoryCheckpointStore();
      const entity = await store.saveEntity({
        attributes: {},
        name: "example.com",
        relationships: [],
        sessionId: "session-1",
        type: "domain",
      });

      const fact = await store.saveFact({
        confidence: 0.9,
        content: "Test fact",
      });

      await store.close();

      expect(await store.getEntity(entity.id)).toBeNull();
      expect(await store.getFact(fact.id)).toBeNull();
      expect(await store.listEntities({})).toEqual([]);
      expect(await store.listFacts({})).toEqual([]);
    });
  });

  describe("MemoryStore type satisfaction", () => {
    it("should satisfy MemoryStore interface", async () => {
      const store = new InMemoryCheckpointStore();
      expect(typeof store.saveEntity).toBe("function");
      expect(typeof store.getEntity).toBe("function");
      expect(typeof store.listEntities).toBe("function");
      expect(typeof store.updateEntity).toBe("function");
      expect(typeof store.deleteEntity).toBe("function");
      expect(typeof store.saveFact).toBe("function");
      expect(typeof store.getFact).toBe("function");
      expect(typeof store.listFacts).toBe("function");
      expect(typeof store.deleteFact).toBe("function");
    });
  });

  describe("searchEntitiesSemantic - extra", () => {
    it("should throw error for mismatched vector dimensions", async () => {
      const store = new InMemoryCheckpointStore();
      await store.saveEntity({
        attributes: {},
        embedding: [1, 0, 0],
        name: "Entity A",
        relationships: [],
        sessionId: "session-1",
        type: "test",
      });

      await expect(
        store.searchEntitiesSemantic([1, 0], { sessionId: "session-1" })
      ).rejects.toThrow("Vector dimensions must match: 2 vs 3");
    });
  });
});
