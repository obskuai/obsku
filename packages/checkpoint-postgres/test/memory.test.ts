import { describe, expect, it } from "bun:test";
import { PostgresCheckpointStore } from "../src/postgres-store";
import {
  createIsolatedPostgresStore,
  runMemoryBackendCapabilityMatrixTests,
  runMemoryTests,
} from "./framework-shared-test-helpers";

const POSTGRES_URL = process.env.POSTGRES_URL;

type PostgresMemoryStore = PostgresCheckpointStore & {
  createSession: (directory: string, options?: Record<string, unknown>) => Promise<{ id: string }>;
  deleteEntity: (id: string) => Promise<void>;
  deleteFact: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  getEntity: (id: string) => Promise<any>;
  getFact: (id: string) => Promise<any>;
  listEntities: (options: Record<string, unknown>) => Promise<Array<any>>;
  listFacts: (options: Record<string, unknown>) => Promise<Array<any>>;
  saveEntity: (entity: Record<string, unknown>) => Promise<any>;
  saveFact: (fact: Record<string, unknown>) => Promise<any>;
  searchEntitiesSemantic: (
    embedding: Array<number>,
    options?: Record<string, unknown>
  ) => Promise<Array<any>>;
  searchFactsSemantic: (
    embedding: Array<number>,
    options?: Record<string, unknown>
  ) => Promise<Array<any>>;
  setup: () => Promise<void>;
  updateEntity: (id: string, updates: Record<string, unknown>) => Promise<void>;
};

function createPostgresMemoryStore(): PostgresMemoryStore {
  return new PostgresCheckpointStore(POSTGRES_URL!) as unknown as PostgresMemoryStore;
}

describe.skipIf(!POSTGRES_URL)("PostgresCheckpointStore - MemoryStore Implementation", () => {
  runMemoryTests({
    createStore: async () => createIsolatedPostgresStore(POSTGRES_URL!),
    description: "PostgresCheckpointStore - MemoryStore",
    hasSemanticSearch: true,
  });

  runMemoryBackendCapabilityMatrixTests();

  describe("Postgres Memory Backend Specific", () => {
    describe("cascade delete", () => {
      it("should cascade delete entities when session is deleted", async () => {
        const store = createPostgresMemoryStore();
        await store.setup();
        const tempSession = await store.createSession("./temp-cascade", { title: "Cascade Test" });

        const entity = await store.saveEntity({
          attributes: {},
          name: "cascade-test.com",
          relationships: [],
          sessionId: tempSession.id,
          type: "domain",
        });

        const beforeDelete = await store.getEntity(entity.id);
        expect(beforeDelete).not.toBeNull();

        await store.deleteSession(tempSession.id);

        const afterDelete = await store.getEntity(entity.id);
        expect(afterDelete).toBeNull();

        await store.close();
      });

      it("should set sourceSessionId to null when session is deleted (facts)", async () => {
        const store = createPostgresMemoryStore();
        await store.setup();
        const tempSession = await store.createSession("./temp-fact-cascade", {
          title: "Fact Cascade Test",
        });

        const fact = await store.saveFact({
          confidence: 1.0,
          content: "Linked to temp session",
          sourceSessionId: tempSession.id,
        });

        const beforeDelete = await store.getFact(fact.id);
        expect(beforeDelete?.sourceSessionId).toBe(tempSession.id);

        await store.deleteSession(tempSession.id);

        const afterDelete = await store.getFact(fact.id);
        expect(afterDelete).not.toBeNull();
        expect(afterDelete?.sourceSessionId).toBeUndefined();

        await store.deleteFact(fact.id);
        await store.close();
      });
    });

    describe("serialization", () => {
      it("should serialize and deserialize complex attributes", async () => {
        const store = createPostgresMemoryStore();
        await store.setup();
        const session = await store.createSession("./test");

        const entity = await store.saveEntity({
          attributes: {
            array: [1, 2, 3],
            boolValue: true,
            nested: { deep: { value: 123 } },
            nullValue: null,
          },
          name: "complex-entity",
          relationships: [
            { targetId: "target-1", type: "relates_to" },
            { targetId: "target-2", type: "owns" },
          ],
          sessionId: session.id,
          type: "test",
        });

        const retrieved = await store.getEntity(entity.id);

        expect(retrieved?.attributes).toEqual({
          array: [1, 2, 3],
          boolValue: true,
          nested: { deep: { value: 123 } },
          nullValue: null,
        });
        expect(retrieved?.relationships).toEqual([
          { targetId: "target-1", type: "relates_to" },
          { targetId: "target-2", type: "owns" },
        ]);

        await store.deleteEntity(entity.id);
        await store.close();
      });
    });
  });
});
