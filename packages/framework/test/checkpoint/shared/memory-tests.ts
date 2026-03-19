import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Entity, Fact, MemoryStore, MemoryStoreOperations } from "@obsku/framework";

// =============================================================================
// Types
// =============================================================================

/** Combined store type for tests: needs session management + entity/fact ops + semantic search */
export type TestMemoryStore = MemoryStore &
  Pick<MemoryStoreOperations, "searchEntitiesSemantic" | "searchFactsSemantic">;

export type MemoryStoreContext = {
  cleanup?: () => Promise<void>;
  store: TestMemoryStore;
};

export type MemoryTestOptions = {
  afterEach?: () => Promise<void>;
  createStore: () => Promise<MemoryStoreContext> | MemoryStoreContext;
  description?: string;
  hasSemanticSearch?: boolean;
};

async function expectRejectsWithMessage(
  operation: Promise<unknown>,
  matcher: RegExp
): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected rejection matching ${matcher.toString()}`);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(matcher);
  }
}

// =============================================================================
// Factory
// =============================================================================

export function runMemoryTests(options: MemoryTestOptions): void {
  const label = options.description ?? "MemoryStore";

  describe(label, () => {
    let store: TestMemoryStore;
    let cleanup: (() => Promise<void>) | undefined;
    let sessionId: string;

    beforeEach(async () => {
      const ctx = await options.createStore();
      store = ctx.store;
      cleanup = ctx.cleanup;
      // Create a session to normalize across backends (SQLite/Postgres need real sessions)
      const session = await store.createSession("./test");
      sessionId = session.id;
    });

    afterEach(async () => {
      if (cleanup) {
        await cleanup();
      }
      if (options.afterEach) {
        await options.afterEach();
      }
    });

    // ========================================================================
    // Entity Tests
    // ========================================================================

    describe("saveEntity", () => {
      it("should save an entity with auto-generated id and timestamps", async () => {
        const entity: Entity = await store.saveEntity({
          attributes: { ip: "192.168.1.1" },
          name: "example.com",
          relationships: [],
          sessionId,
          type: "domain",
          workspaceId: "workspace-1",
        });

        expect(entity.id).toBeDefined();
        expect(entity.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(entity.name).toBe("example.com");
        expect(entity.type).toBe("domain");
        expect(entity.sessionId).toBe(sessionId);
        expect(entity.workspaceId).toBe("workspace-1");
        expect(entity.attributes).toEqual({ ip: "192.168.1.1" });
        expect(entity.createdAt).toBeGreaterThan(0);
        expect(entity.updatedAt).toBeGreaterThan(0);
        expect(entity.createdAt).toBe(entity.updatedAt);
      });

      it("should save entity without optional workspaceId", async () => {
        const entity: Entity = await store.saveEntity({
          attributes: {},
          name: "John Doe",
          relationships: [],
          sessionId,
          type: "person",
        });

        expect(entity.workspaceId).toBeUndefined();
        expect(entity.name).toBe("John Doe");
      });
    });

    describe("getEntity", () => {
      it("should retrieve saved entity by id", async () => {
        const saved: Entity = await store.saveEntity({
          attributes: {},
          name: "example.com",
          relationships: [],
          sessionId,
          type: "domain",
        });

        const retrieved: Entity | null = await store.getEntity(saved.id);

        expect(retrieved).toBeDefined();
        expect(retrieved?.id).toBe(saved.id);
        expect(retrieved?.name).toBe("example.com");
      });

      it("should return null for non-existent entity", async () => {
        const result = await store.getEntity("non-existent-id");
        expect(result).toBeNull();
      });
    });

    describe("listEntities", () => {
      let session2Id: string;

      beforeEach(async () => {
        const session2 = await store.createSession("./test2");
        session2Id = session2.id;

        await store.saveEntity({
          attributes: {},
          name: "example.com",
          relationships: [],
          sessionId,
          type: "domain",
          workspaceId: "workspace-1",
        });
        await store.saveEntity({
          attributes: {},
          name: "192.168.1.1",
          relationships: [],
          sessionId,
          type: "ip",
          workspaceId: "workspace-1",
        });
        await store.saveEntity({
          attributes: {},
          name: "test.com",
          relationships: [],
          sessionId: session2Id,
          type: "domain",
          workspaceId: "workspace-1",
        });
        await store.saveEntity({
          attributes: {},
          name: "John Doe",
          relationships: [],
          sessionId: session2Id,
          type: "person",
          workspaceId: "workspace-2",
        });
      });

      it("should list all entities when no filters applied", async () => {
        const entities: Array<Entity> = await store.listEntities({});
        expect(entities.length).toBeGreaterThanOrEqual(4);
      });

      it("should filter by sessionId", async () => {
        const entities: Array<Entity> = await store.listEntities({ sessionId });
        expect(entities.length).toBe(2);
        expect(entities.every((e: Entity) => e.sessionId === sessionId)).toBe(true);
      });

      it("should filter by workspaceId", async () => {
        const entities: Array<Entity> = await store.listEntities({ workspaceId: "workspace-1" });
        expect(entities.length).toBe(3);
        expect(entities.every((e: Entity) => e.workspaceId === "workspace-1")).toBe(true);
      });

      it("should filter by type", async () => {
        const entities: Array<Entity> = await store.listEntities({ type: "domain" });
        expect(entities.length).toBe(2);
        expect(entities.every((e: Entity) => e.type === "domain")).toBe(true);
      });

      it("should apply limit", async () => {
        const entities: Array<Entity> = await store.listEntities({ limit: 2 });
        expect(entities.length).toBe(2);
      });

      it("should combine multiple filters", async () => {
        const entities: Array<Entity> = await store.listEntities({
          type: "domain",
          workspaceId: "workspace-1",
        });
        expect(entities.length).toBe(2);
        expect(
          entities.every((e: Entity) => e.workspaceId === "workspace-1" && e.type === "domain")
        ).toBe(true);
      });

      it("should return empty array when no matches", async () => {
        const entities: Array<Entity> = await store.listEntities({ sessionId: "non-existent" });
        expect(entities).toEqual([]);
      });
    });

    describe("updateEntity", () => {
      it("should update entity fields", async () => {
        const saved: Entity = await store.saveEntity({
          attributes: { status: "active" },
          name: "example.com",
          relationships: [],
          sessionId,
          type: "domain",
        });

        const originalUpdatedAt = saved.updatedAt;
        await new Promise((resolve) => setTimeout(resolve, 10));

        await store.updateEntity(saved.id, {
          attributes: { owner: "admin", status: "inactive" },
          name: "updated-example.com",
        });

        const updated: Entity | null = await store.getEntity(saved.id);
        expect(updated?.name).toBe("updated-example.com");
        expect(updated?.attributes).toEqual({ owner: "admin", status: "inactive" });
        expect(updated?.updatedAt).toBeGreaterThan(originalUpdatedAt);
        expect(updated?.type).toBe("domain");
        expect(updated?.sessionId).toBe(sessionId);
      });

      it("should throw error for non-existent entity", async () => {
        await expectRejectsWithMessage(
          store.updateEntity("non-existent", { name: "test" }),
          /Entity not found/
        );
      });
    });

    describe("deleteEntity", () => {
      it("should delete entity by id", async () => {
        const saved: Entity = await store.saveEntity({
          attributes: {},
          name: "example.com",
          relationships: [],
          sessionId,
          type: "domain",
        });

        await store.deleteEntity(saved.id);

        const retrieved = await store.getEntity(saved.id);
        expect(retrieved).toBeNull();
      });

      it("should not throw when deleting non-existent entity", async () => {
        await store.deleteEntity("non-existent");
      });
    });

    // ========================================================================
    // Fact Tests
    // ========================================================================

    describe("saveFact", () => {
      it("should save a fact with auto-generated id and timestamp", async () => {
        const fact: Fact = await store.saveFact({
          confidence: 0.95,
          content: "The target domain is example.com",
          sourceSessionId: sessionId,
          workspaceId: "workspace-1",
        });

        expect(fact.id).toBeDefined();
        expect(fact.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(fact.content).toBe("The target domain is example.com");
        expect(fact.confidence).toBe(0.95);
        expect(fact.workspaceId).toBe("workspace-1");
        expect(fact.sourceSessionId).toBe(sessionId);
        expect(fact.createdAt).toBeGreaterThan(0);
      });

      it("should save fact without optional fields", async () => {
        const fact: Fact = await store.saveFact({
          confidence: 0.8,
          content: "A simple fact",
        });

        expect(fact.workspaceId).toBeUndefined();
        expect(fact.sourceSessionId).toBeUndefined();
      });
    });

    describe("getFact", () => {
      it("should retrieve saved fact by id", async () => {
        const saved: Fact = await store.saveFact({
          confidence: 0.9,
          content: "Test fact",
        });

        const retrieved: Fact | null = await store.getFact(saved.id);

        expect(retrieved).toBeDefined();
        expect(retrieved?.id).toBe(saved.id);
        expect(retrieved?.content).toBe("Test fact");
      });

      it("should return null for non-existent fact", async () => {
        const result = await store.getFact("non-existent-id");
        expect(result).toBeNull();
      });
    });

    describe("listFacts", () => {
      beforeEach(async () => {
        await store.saveFact({
          confidence: 0.9,
          content: "Fact 1",
          sourceSessionId: sessionId,
          workspaceId: "workspace-1",
        });
        await store.saveFact({
          confidence: 0.7,
          content: "Fact 2",
          sourceSessionId: sessionId,
          workspaceId: "workspace-1",
        });
        await store.saveFact({
          confidence: 0.95,
          content: "Fact 3",
          workspaceId: "workspace-2",
        });
        await store.saveFact({
          confidence: 0.5,
          content: "Fact 4 (no workspace)",
        });
      });

      it("should list all facts when no filters applied", async () => {
        const facts: Array<Fact> = await store.listFacts({});
        expect(facts.length).toBeGreaterThanOrEqual(4);
      });

      it("should filter by workspaceId", async () => {
        const facts: Array<Fact> = await store.listFacts({ workspaceId: "workspace-1" });
        expect(facts.length).toBe(2);
        expect(facts.every((f: Fact) => f.workspaceId === "workspace-1")).toBe(true);
      });

      it("should filter by minConfidence", async () => {
        const facts: Array<Fact> = await store.listFacts({ minConfidence: 0.8 });
        expect(facts.length).toBeGreaterThanOrEqual(2);
        expect(facts.every((f: Fact) => f.confidence >= 0.8)).toBe(true);
      });

      it("should apply limit", async () => {
        const facts: Array<Fact> = await store.listFacts({ limit: 2 });
        expect(facts.length).toBe(2);
      });

      it("should combine filters", async () => {
        const facts: Array<Fact> = await store.listFacts({
          minConfidence: 0.8,
          workspaceId: "workspace-1",
        });
        expect(facts.length).toBe(1);
        expect(facts[0].content).toBe("Fact 1");
      });

      it("should return empty array when no matches", async () => {
        const facts: Array<Fact> = await store.listFacts({ workspaceId: "non-existent" });
        expect(facts).toEqual([]);
      });
    });

    describe("deleteFact", () => {
      it("should delete fact by id", async () => {
        const saved: Fact = await store.saveFact({
          confidence: 0.9,
          content: "Test fact",
        });

        await store.deleteFact(saved.id);

        const retrieved = await store.getFact(saved.id);
        expect(retrieved).toBeNull();
      });

      it("should not throw when deleting non-existent fact", async () => {
        await store.deleteFact("non-existent");
      });
    });

    // ========================================================================
    // Semantic Search Tests (conditional)
    // ========================================================================

    if (options.hasSemanticSearch) {
      describe("searchEntitiesSemantic", () => {
        it("should return entities sorted by similarity", async () => {
          await store.saveEntity({
            attributes: {},
            embedding: [1, 0, 0],
            name: "Entity A",
            relationships: [],
            sessionId,
            type: "test",
          });
          await store.saveEntity({
            attributes: {},
            embedding: [0.9, 0.1, 0],
            name: "Entity B",
            relationships: [],
            sessionId,
            type: "test",
          });
          await store.saveEntity({
            attributes: {},
            embedding: [0, 1, 0],
            name: "Entity C",
            relationships: [],
            sessionId,
            type: "test",
          });

          const results: Array<Entity> = await store.searchEntitiesSemantic([1, 0, 0]);

          expect(results.length).toBe(3);
          expect(results[0].name).toBe("Entity A");
          expect(results[1].name).toBe("Entity B");
          expect(results[2].name).toBe("Entity C");
        });

        it("should respect topK option", async () => {
          await store.saveEntity({
            attributes: {},
            embedding: [1, 0, 0],
            name: "Entity A",
            relationships: [],
            sessionId,
            type: "test",
          });
          await store.saveEntity({
            attributes: {},
            embedding: [0.5, 0.5, 0],
            name: "Entity B",
            relationships: [],
            sessionId,
            type: "test",
          });
          await store.saveEntity({
            attributes: {},
            embedding: [0, 1, 0],
            name: "Entity C",
            relationships: [],
            sessionId,
            type: "test",
          });

          const results: Array<Entity> = await store.searchEntitiesSemantic([1, 0, 0], { topK: 2 });

          expect(results.length).toBe(2);
        });

        it("should respect threshold option", async () => {
          await store.saveEntity({
            attributes: {},
            embedding: [1, 0, 0],
            name: "Entity A",
            relationships: [],
            sessionId,
            type: "test",
          });
          await store.saveEntity({
            attributes: {},
            embedding: [0, 1, 0],
            name: "Entity B",
            relationships: [],
            sessionId,
            type: "test",
          });

          const results: Array<Entity> = await store.searchEntitiesSemantic([1, 0, 0], {
            threshold: 0.5,
          });

          expect(results.length).toBe(1);
          expect(results[0].name).toBe("Entity A");
        });

        it("should filter by sessionId", async () => {
          const session2 = await store.createSession("./test-sem");
          await store.saveEntity({
            attributes: {},
            embedding: [1, 0, 0],
            name: "Entity A",
            relationships: [],
            sessionId,
            type: "test",
          });
          await store.saveEntity({
            attributes: {},
            embedding: [1, 0, 0],
            name: "Entity B",
            relationships: [],
            sessionId: session2.id,
            type: "test",
          });

          const results: Array<Entity> = await store.searchEntitiesSemantic([1, 0, 0], {
            sessionId,
          });

          expect(results.length).toBe(1);
          expect(results[0].name).toBe("Entity A");
        });

        it("should filter by workspaceId", async () => {
          await store.saveEntity({
            attributes: {},
            embedding: [1, 0, 0],
            name: "Entity A",
            relationships: [],
            sessionId,
            type: "test",
            workspaceId: "workspace-1",
          });
          await store.saveEntity({
            attributes: {},
            embedding: [1, 0, 0],
            name: "Entity B",
            relationships: [],
            sessionId,
            type: "test",
            workspaceId: "workspace-2",
          });

          const results: Array<Entity> = await store.searchEntitiesSemantic([1, 0, 0], {
            workspaceId: "workspace-1",
          });

          expect(results.length).toBe(1);
          expect(results[0].name).toBe("Entity A");
        });

        it("should skip entities without embeddings", async () => {
          await store.saveEntity({
            attributes: {},
            embedding: [1, 0, 0],
            name: "Entity A",
            relationships: [],
            sessionId,
            type: "test",
          });
          await store.saveEntity({
            attributes: {},
            name: "Entity B",
            relationships: [],
            sessionId,
            type: "test",
          });

          const results: Array<Entity> = await store.searchEntitiesSemantic([1, 0, 0]);

          expect(results.length).toBe(1);
          expect(results[0].name).toBe("Entity A");
        });

        it("should return empty array when no matches", async () => {
          const results: Array<Entity> = await store.searchEntitiesSemantic([1, 0, 0]);
          expect(results).toEqual([]);
        });
      });

      describe("searchFactsSemantic", () => {
        it("should return facts sorted by similarity", async () => {
          await store.saveFact({
            confidence: 0.9,
            content: "Fact A",
            embedding: [1, 0, 0],
            workspaceId: "workspace-1",
          });
          await store.saveFact({
            confidence: 0.8,
            content: "Fact B",
            embedding: [0.9, 0.1, 0],
            workspaceId: "workspace-1",
          });
          await store.saveFact({
            confidence: 0.7,
            content: "Fact C",
            embedding: [0, 1, 0],
            workspaceId: "workspace-1",
          });

          const results: Array<Fact> = await store.searchFactsSemantic([1, 0, 0]);

          expect(results.length).toBe(3);
          expect(results[0].content).toBe("Fact A");
          expect(results[1].content).toBe("Fact B");
          expect(results[2].content).toBe("Fact C");
        });

        it("should respect topK option", async () => {
          await store.saveFact({
            confidence: 0.9,
            content: "Fact A",
            embedding: [1, 0, 0],
          });
          await store.saveFact({
            confidence: 0.8,
            content: "Fact B",
            embedding: [0.5, 0.5, 0],
          });
          await store.saveFact({
            confidence: 0.7,
            content: "Fact C",
            embedding: [0, 1, 0],
          });

          const results: Array<Fact> = await store.searchFactsSemantic([1, 0, 0], { topK: 2 });

          expect(results.length).toBe(2);
        });

        it("should respect threshold option", async () => {
          await store.saveFact({
            confidence: 0.9,
            content: "Fact A",
            embedding: [1, 0, 0],
          });
          await store.saveFact({
            confidence: 0.8,
            content: "Fact B",
            embedding: [0, 1, 0],
          });

          const results: Array<Fact> = await store.searchFactsSemantic([1, 0, 0], {
            threshold: 0.5,
          });

          expect(results.length).toBe(1);
          expect(results[0].content).toBe("Fact A");
        });

        it("should filter by workspaceId", async () => {
          await store.saveFact({
            confidence: 0.9,
            content: "Fact A",
            embedding: [1, 0, 0],
            workspaceId: "workspace-1",
          });
          await store.saveFact({
            confidence: 0.9,
            content: "Fact B",
            embedding: [1, 0, 0],
            workspaceId: "workspace-2",
          });

          const results: Array<Fact> = await store.searchFactsSemantic([1, 0, 0], {
            workspaceId: "workspace-1",
          });

          expect(results.length).toBe(1);
          expect(results[0].content).toBe("Fact A");
        });

        it("should skip facts without embeddings", async () => {
          await store.saveFact({
            confidence: 0.9,
            content: "Fact A",
            embedding: [1, 0, 0],
          });
          await store.saveFact({
            confidence: 0.8,
            content: "Fact B",
          });

          const results: Array<Fact> = await store.searchFactsSemantic([1, 0, 0]);

          expect(results.length).toBe(1);
          expect(results[0].content).toBe("Fact A");
        });

        it("should return empty array when no matches", async () => {
          const results: Array<Fact> = await store.searchFactsSemantic([1, 0, 0]);
          expect(results).toEqual([]);
        });

        it("should throw error for mismatched vector dimensions", async () => {
          await store.saveFact({
            confidence: 0.9,
            content: "Fact A",
            embedding: [1, 0, 0],
          });

          await expectRejectsWithMessage(
            store.searchFactsSemantic([1, 0]),
            /Vector dimensions must match/
          );
        });
      });
    }
  });
}

const POSTGRES_URL = process.env.POSTGRES_URL;
const REDIS_URL = process.env.REDIS_URL;

type MatrixStoreContext = {
  cleanup: () => Promise<void>;
  store: TestMemoryStore;
};

async function createSqliteMatrixStore(): Promise<MatrixStoreContext> {
  const { SqliteCheckpointStore } = await import(
    "../../../../checkpoint-sqlite/src/sqlite-store.js"
  );
  const store = new SqliteCheckpointStore(":memory:");
  const context: MatrixStoreContext = {
    cleanup: async () => {
      await store.close();
    },
    store: store as unknown as TestMemoryStore,
  };
  return context;
}

async function createRedisMatrixStore(): Promise<MatrixStoreContext> {
  const { RedisCheckpointStore } = await import("../../../../checkpoint-redis/src/redis-store.js");
  const prefix = `test:capability-matrix:${Date.now()}:${Math.random().toString(36).slice(2)}:`;
  const store = new RedisCheckpointStore({ prefix, url: REDIS_URL! });
  const context: MatrixStoreContext = {
    cleanup: async () => {
      await store.close();
    },
    store: store as unknown as TestMemoryStore,
  };
  return context;
}

async function createPostgresSchemaHarness(): Promise<{
  cleanup: () => Promise<void>;
  createStore: () => Promise<TestMemoryStore & { close(): Promise<void>; setup(): Promise<void> }>;
}> {
  const { PostgresCheckpointStore } = await import(
    "../../../../checkpoint-postgres/src/postgres-store.js"
  );
  const schema = `capability_matrix_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const adminStore = new PostgresCheckpointStore(POSTGRES_URL!);
  const pool = (adminStore as unknown as { pool: { query: (sql: string) => Promise<unknown> } })
    .pool;

  await pool.query(`CREATE SCHEMA "${schema}"`);

  const harness = {
    cleanup: async () => {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminStore.close();
    },
    createStore: async () => {
      const store = new PostgresCheckpointStore(POSTGRES_URL!, {
        options: `-c search_path=${schema}`,
      });
      return store as unknown as TestMemoryStore & {
        close(): Promise<void>;
        setup(): Promise<void>;
      };
    },
  };
  return harness;
}

async function assertSupportedSemanticSearch(
  ctxFactory: () => Promise<MatrixStoreContext>
): Promise<void> {
  const ctx = await ctxFactory();

  try {
    const { store } = ctx;
    const session = await store.createSession("./semantic-supported");

    await store.saveEntity({
      attributes: {},
      embedding: [1, 0, 0],
      name: "exact-match-entity",
      relationships: [],
      sessionId: session.id,
      type: "test",
    });
    await store.saveEntity({
      attributes: {},
      embedding: [0, 1, 0],
      name: "orthogonal-entity",
      relationships: [],
      sessionId: session.id,
      type: "test",
    });
    await store.saveFact({
      confidence: 1,
      content: "exact-match-fact",
      embedding: [1, 0, 0],
      workspaceId: "semantic-supported",
    });
    await store.saveFact({
      confidence: 1,
      content: "orthogonal-fact",
      embedding: [0, 1, 0],
      workspaceId: "semantic-supported",
    });

    const entityMatches = await store.searchEntitiesSemantic([1, 0, 0], {
      sessionId: session.id,
      threshold: 0.1,
    });
    const factMatches = await store.searchFactsSemantic([1, 0, 0], {
      threshold: 0.1,
      workspaceId: "semantic-supported",
    });
    const emptyEntityMatches = await store.searchEntitiesSemantic([0, 0, 1], {
      sessionId: session.id,
      threshold: 0.1,
    });
    const emptyFactMatches = await store.searchFactsSemantic([0, 0, 1], {
      threshold: 0.1,
      workspaceId: "semantic-supported",
    });

    expect(entityMatches.map((entity) => entity.name)).toEqual(["exact-match-entity"]);
    expect(factMatches.map((fact) => fact.content)).toEqual(["exact-match-fact"]);
    expect(emptyEntityMatches).toEqual([]);
    expect(emptyFactMatches).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
}

async function assertUnsupportedSemanticSearch(
  ctxFactory: () => Promise<MatrixStoreContext>
): Promise<void> {
  const ctx = await ctxFactory();

  try {
    const { store } = ctx;
    const session = await store.createSession("./semantic-unsupported");

    await store.saveEntity({
      attributes: {},
      embedding: [1, 0, 0],
      name: "stored-but-unsearchable-entity",
      relationships: [],
      sessionId: session.id,
      type: "test",
    });
    await store.saveFact({
      confidence: 1,
      content: "stored-but-unsearchable-fact",
      embedding: [1, 0, 0],
      workspaceId: "semantic-unsupported",
    });

    const entityMatches = await store.searchEntitiesSemantic([1, 0, 0], {
      sessionId: session.id,
    });
    const factMatches = await store.searchFactsSemantic([1, 0, 0], {
      workspaceId: "semantic-unsupported",
    });

    expect(entityMatches).toEqual([]);
    expect(factMatches).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
}

export function runMemoryBackendCapabilityMatrixTests(): void {
  describe("Checkpoint memory backend capability matrix", () => {
    describe("lifecycle semantics", () => {
      it("SQLite auto-inits schema on first use", async () => {
        const ctx = await createSqliteMatrixStore();

        try {
          const session = await ctx.store.createSession("./sqlite-auto-init");
          expect(session.directory).toBe("./sqlite-auto-init");
        } finally {
          await ctx.cleanup();
        }
      });

      describe.skipIf(!POSTGRES_URL)("Postgres", () => {
        it("requires setup before first use, then works after setup", async () => {
          const harness = await createPostgresSchemaHarness();

          try {
            const uninitializedStore = await harness.createStore();
            await expectRejectsWithMessage(
              uninitializedStore.createSession("./postgres-needs-setup"),
              /does not exist/
            );
            await uninitializedStore.close();

            const initializedStore = await harness.createStore();
            await initializedStore.setup();

            const session = await initializedStore.createSession("./postgres-needs-setup");
            expect(session.directory).toBe("./postgres-needs-setup");

            await initializedStore.close();
          } finally {
            await harness.cleanup();
          }
        });
      });

      describe.skipIf(!REDIS_URL)("Redis", () => {
        it("auto-connects on first use without manual connect", async () => {
          const ctx = await createRedisMatrixStore();

          try {
            const session = await ctx.store.createSession("./redis-auto-connect");
            expect(session.directory).toBe("./redis-auto-connect");
          } finally {
            await ctx.cleanup();
          }
        });
      });
    });

    describe("semantic search semantics", () => {
      it("SQLite supports matches and empty-result behavior", async () => {
        await assertSupportedSemanticSearch(createSqliteMatrixStore);
      });

      describe.skipIf(!POSTGRES_URL)("Postgres", () => {
        it("supports matches and empty-result behavior after setup", async () => {
          await assertSupportedSemanticSearch(async () => {
            const harness = await createPostgresSchemaHarness();
            const store = await harness.createStore();
            await store.setup();

            return {
              cleanup: async () => {
                await store.close();
                await harness.cleanup();
              },
              store,
            };
          });
        });
      });

      describe.skipIf(!REDIS_URL)("Redis", () => {
        it("semantic search unsupported is explicit for Redis backend", async () => {
          await assertUnsupportedSemanticSearch(createRedisMatrixStore);
        });
      });
    });
  });
}

function shouldRunSelfCapabilityMatrixTests(): boolean {
  return process.argv.some(
    (arg) =>
      arg.endsWith("packages/framework/test/checkpoint/shared/memory-tests.ts") ||
      arg.endsWith("memory-tests.ts")
  );
}

if (shouldRunSelfCapabilityMatrixTests()) {
  runMemoryBackendCapabilityMatrixTests();
}
