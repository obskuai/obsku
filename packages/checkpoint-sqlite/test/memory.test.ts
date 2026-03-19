import { afterEach, describe, expect, it } from "bun:test";
import { SqliteCheckpointStore } from "../src/sqlite-store";
import {
  runMemoryBackendCapabilityMatrixTests,
  runMemoryTests,
} from "./framework-shared-test-helpers";

runMemoryTests({
  createStore: () => {
    const store = new SqliteCheckpointStore(":memory:");
    return {
      cleanup: async () => {
        await store.close();
      },
      store,
    };
  },
  description: "SqliteCheckpointStore - MemoryStore Implementation",
  hasSemanticSearch: true,
});

runMemoryBackendCapabilityMatrixTests();

describe("SqliteCheckpointStore - Memory Backend Specific", () => {
  let store: SqliteCheckpointStore;

  afterEach(async () => {
    if (store) {
      await store.close();
    }
  });

  describe("Cascade Delete", () => {
    it("should cascade delete entities when session is deleted", async () => {
      store = new SqliteCheckpointStore(":memory:");
      const session = await store.createSession("./test");

      const entity1 = await store.saveEntity({
        attributes: {},
        name: "entity1",
        relationships: [],
        sessionId: session.id,
        type: "test",
      });
      const entity2 = await store.saveEntity({
        attributes: {},
        name: "entity2",
        relationships: [],
        sessionId: session.id,
        type: "test",
      });

      expect(await store.getEntity(entity1.id)).not.toBeNull();
      expect(await store.getEntity(entity2.id)).not.toBeNull();

      await store.deleteSession(session.id);

      expect(await store.getEntity(entity1.id)).toBeNull();
      expect(await store.getEntity(entity2.id)).toBeNull();
    });

    it("should set sourceSessionId to NULL when source session is deleted (facts)", async () => {
      store = new SqliteCheckpointStore(":memory:");
      const session = await store.createSession("./test");

      const fact = await store.saveFact({
        confidence: 0.9,
        content: "Test fact with source session",
        sourceSessionId: session.id,
      });

      expect(await store.getFact(fact.id)).toMatchObject({
        sourceSessionId: session.id,
      });

      await store.deleteSession(session.id);

      const retrievedFact = await store.getFact(fact.id);
      expect(retrievedFact).not.toBeNull();
      expect(retrievedFact?.sourceSessionId).toBeUndefined();
    });
  });

  describe("MemoryStore type satisfaction", () => {
    it("should satisfy MemoryStore interface", async () => {
      store = new SqliteCheckpointStore(":memory:");
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
});
