import { describe, expect, it } from "bun:test";
import { PostgresCheckpointStore } from "../src/postgres-store";
import { createIsolatedPostgresStore, runStoreTests } from "./framework-shared-test-helpers";

const POSTGRES_URL = process.env.POSTGRES_URL;
const shouldSkip = !POSTGRES_URL;

describe.skipIf(shouldSkip)("PostgresCheckpointStore", () => {
  runStoreTests({
    createStore: async () => {
      return createIsolatedPostgresStore(POSTGRES_URL!);
    },
    description: "PostgresCheckpointStore",
  });

  describe("Postgres Backend Specific", () => {
    describe("Checkpoints - UNIQUE constraint", () => {
      it("should throw error for duplicate version in same session/namespace", async () => {
        const store = new PostgresCheckpointStore(POSTGRES_URL!);
        await store.setup();
        const session = await store.createSession("/test/dir");
        await store.saveCheckpoint({
          namespace: "default",
          nodeResults: {},
          pendingNodes: [],
          sessionId: session.id,
          source: "input",
          step: 0,
          version: 1,
        });

        await expect(
          store.saveCheckpoint({
            namespace: "default",
            nodeResults: {},
            pendingNodes: [],
            sessionId: session.id,
            source: "loop",
            step: 1,
            version: 1,
          })
        ).rejects.toThrow();

        await store.close();
      });

      it("should allow same version in different namespaces", async () => {
        const store = new PostgresCheckpointStore(POSTGRES_URL!);
        await store.setup();
        const session = await store.createSession("/test/dir");
        await store.saveCheckpoint({
          namespace: "ns1",
          nodeResults: {},
          pendingNodes: [],
          sessionId: session.id,
          source: "input",
          step: 0,
          version: 1,
        });

        const cp2 = await store.saveCheckpoint({
          namespace: "ns2",
          nodeResults: {},
          pendingNodes: [],
          sessionId: session.id,
          source: "input",
          step: 0,
          version: 1,
        });

        expect(cp2.version).toBe(1);

        await store.close();
      });
    });

    describe("Concurrency", () => {
      it("should handle parallel saveCheckpoint with different versions", async () => {
        const store = new PostgresCheckpointStore(POSTGRES_URL!);
        await store.setup();
        const session = await store.createSession("/test/dir");

        const results = await Promise.all([
          store.saveCheckpoint({
            namespace: "default",
            nodeResults: {},
            pendingNodes: [],
            sessionId: session.id,
            source: "input",
            step: 0,
            version: 1,
          }),
          store.saveCheckpoint({
            namespace: "default",
            nodeResults: {},
            pendingNodes: [],
            sessionId: session.id,
            source: "loop",
            step: 1,
            version: 2,
          }),
          store.saveCheckpoint({
            namespace: "default",
            nodeResults: {},
            pendingNodes: [],
            sessionId: session.id,
            source: "loop",
            step: 2,
            version: 3,
          }),
        ]);

        expect(results).toHaveLength(3);
        const versions = results.map((r) => r.version).sort();
        expect(versions).toEqual([1, 2, 3]);

        await store.close();
      });
    });

    describe("Messages - Serialization", () => {
      it("should serialize and deserialize tool results with status", async () => {
        const store = new PostgresCheckpointStore(POSTGRES_URL!);
        await store.setup();
        const session = await store.createSession("/test/dir");
        const toolResults = [
          { content: "error message", status: "error", toolUseId: "tool-1" },
          { content: "success output", status: "success", toolUseId: "tool-2" },
        ];

        await store.addMessage(session.id, {
          content: "Tool Results",
          role: "tool",
          sessionId: session.id,
          toolResults,
        });

        const messages = await store.getMessages(session.id);

        expect(messages).toHaveLength(1);
        expect(messages[0].toolResults).toHaveLength(2);
        expect(messages[0].toolResults![0].status).toBe("error");
        expect(messages[0].toolResults![1].status).toBe("success");

        await store.close();
      });

      it("should handle tool results without status (backward compat)", async () => {
        const store = new PostgresCheckpointStore(POSTGRES_URL!);
        await store.setup();
        const session = await store.createSession("/test/dir");
        const toolResults = [{ content: "old format", toolUseId: "tool-1" }];

        await store.addMessage(session.id, {
          content: "Old Tool Result",
          role: "tool",
          sessionId: session.id,
          toolResults,
        });

        const messages = await store.getMessages(session.id);

        expect(messages).toHaveLength(1);
        expect(messages[0].toolResults![0].status).toBeUndefined();

        await store.close();
      });
    });

    describe("Close", () => {
      it("should close without error", async () => {
        const newStore = new PostgresCheckpointStore(POSTGRES_URL!);
        await newStore.setup();
        const session = await newStore.createSession("/test/dir");
        await newStore.addMessage(session.id, {
          content: "Hello",
          role: "user",
          sessionId: session.id,
        });

        await newStore.close();
      });
    });

    describe("Edge Cases", () => {
      it("should handle checkpoint with cycleState", async () => {
        const store = new PostgresCheckpointStore(POSTGRES_URL!);
        await store.setup();
        const session = await store.createSession("/test/dir");
        const checkpoint = await store.saveCheckpoint({
          cycleState: { backEdge: "edge1", iteration: 3 },
          namespace: "default",
          nodeResults: {},
          pendingNodes: [],
          sessionId: session.id,
          source: "loop",
          step: 0,
          version: 1,
        });

        const retrieved = await store.getCheckpoint(checkpoint.id);
        expect(retrieved?.cycleState).toEqual({ backEdge: "edge1", iteration: 3 });

        await store.close();
      });
    });
  });
});
