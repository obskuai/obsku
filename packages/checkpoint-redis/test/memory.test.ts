import { describe, expect, it } from "bun:test";
import { RedisCheckpointStore } from "../src/redis-store";
import {
  runMemoryBackendCapabilityMatrixTests,
  runMemoryTests,
} from "./framework-shared-test-helpers";

const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("RedisCheckpointStore - MemoryStore Implementation", () => {
  runMemoryTests({
    createStore: () => {
      const prefix = `test:memory:${Date.now()}:${Math.random().toString(36).slice(2)}:`;
      const store = new RedisCheckpointStore({ prefix, url: REDIS_URL! });
      return {
        cleanup: async () => {
          await store.close();
        },
        store,
      };
    },
    description: "RedisCheckpointStore - MemoryStore",
    hasSemanticSearch: false,
  });

  runMemoryBackendCapabilityMatrixTests();

  describe("Redis Memory Backend Specific", () => {
    describe("MemoryStore type satisfaction", () => {
      it("should satisfy MemoryStore interface", async () => {
        const prefix = `test:type:${Date.now()}:`;
        const store = new RedisCheckpointStore({ prefix, url: REDIS_URL! });
        expect(typeof store.saveEntity).toBe("function");
        expect(typeof store.getEntity).toBe("function");
        expect(typeof store.listEntities).toBe("function");
        expect(typeof store.updateEntity).toBe("function");
        expect(typeof store.deleteEntity).toBe("function");
        expect(typeof store.saveFact).toBe("function");
        expect(typeof store.getFact).toBe("function");
        expect(typeof store.listFacts).toBe("function");
        expect(typeof store.deleteFact).toBe("function");

        await store.close();
      });
    });

    describe("Entity Index Updates", () => {
      it("should update indexes when type changes", async () => {
        const prefix = `test:idx:${Date.now()}:`;
        const store = new RedisCheckpointStore({ prefix, url: REDIS_URL! });
        const saved = await store.saveEntity({
          attributes: {},
          name: "entity1",
          relationships: [],
          sessionId: "session-index-update",
          type: "old-type",
        });

        await store.updateEntity(saved.id, { type: "new-type" });

        const oldTypeEntities = await store.listEntities({ type: "old-type" });
        const newTypeEntities = await store.listEntities({ type: "new-type" });

        expect(oldTypeEntities.find((e) => e.id === saved.id)).toBeUndefined();
        expect(newTypeEntities.find((e) => e.id === saved.id)).toBeDefined();

        await store.close();
      });
    });

    describe("Delete Index Cleanup", () => {
      it("should remove entity from indexes", async () => {
        const prefix = `test:delidx:${Date.now()}:`;
        const store = new RedisCheckpointStore({ prefix, url: REDIS_URL! });
        const saved = await store.saveEntity({
          attributes: {},
          name: "entity1",
          relationships: [],
          sessionId: "session-delete-index",
          type: "delete-type",
          workspaceId: "ws-delete-index",
        });

        await store.deleteEntity(saved.id);

        const bySession = await store.listEntities({ sessionId: "session-delete-index" });
        const byWorkspace = await store.listEntities({ workspaceId: "ws-delete-index" });
        const byType = await store.listEntities({ type: "delete-type" });

        expect(bySession.find((e) => e.id === saved.id)).toBeUndefined();
        expect(byWorkspace.find((e) => e.id === saved.id)).toBeUndefined();
        expect(byType.find((e) => e.id === saved.id)).toBeUndefined();

        await store.close();
      });

      it("should remove fact from workspace index", async () => {
        const prefix = `test:factdelidx:${Date.now()}:`;
        const store = new RedisCheckpointStore({ prefix, url: REDIS_URL! });
        const saved = await store.saveFact({
          confidence: 0.9,
          content: "Fact to delete",
          workspaceId: "ws-fact-delete-index",
        });

        await store.deleteFact(saved.id);

        const facts = await store.listFacts({ workspaceId: "ws-fact-delete-index" });
        expect(facts.find((f) => f.id === saved.id)).toBeUndefined();

        await store.close();
      });
    });
  });
});
