import { describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStoreTests } from "./framework-shared-test-helpers";
import { SqliteCheckpointStore } from "../src/sqlite-store";

runStoreTests({
  createStore: () => {
    const store = new SqliteCheckpointStore();
    return { store };
  },
  description: "SqliteCheckpointStore",
});

describe("SqliteCheckpointStore - Backend Specific", () => {
  describe("Session Delete (basic)", () => {
    it("should delete a session", async () => {
      const store = new SqliteCheckpointStore();
      const session = await store.createSession("/test/dir");
      await store.deleteSession(session.id);

      const retrieved = await store.getSession(session.id);
      expect(retrieved).toBeNull();
    });
  });

  describe("Messages - Serialization", () => {
    it("should serialize and deserialize tool calls", async () => {
      const store = new SqliteCheckpointStore();
      const session = await store.createSession("/test/dir");
      const toolCalls = [{ input: { arg: "value" }, name: "testTool", toolUseId: "tool-1" }];

      await store.addMessage(session.id, {
        content: "Using tool",
        role: "assistant",
        sessionId: session.id,
        toolCalls,
      });

      const messages = await store.getMessages(session.id);

      expect(messages).toHaveLength(1);
      expect(messages[0].toolCalls).toEqual(toolCalls);
    });

    it("should serialize and deserialize tool results", async () => {
      const store = new SqliteCheckpointStore();
      const session = await store.createSession("/test/dir");
      const toolResults = [{ content: "result", toolUseId: "tool-1" }];

      await store.addMessage(session.id, {
        content: "Result",
        role: "tool",
        sessionId: session.id,
        toolResults,
      });

      const messages = await store.getMessages(session.id);

      expect(messages).toHaveLength(1);
      expect(messages[0].toolResults).toEqual(toolResults);
    });

    it("should serialize and deserialize tool results with status", async () => {
      const store = new SqliteCheckpointStore();
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
      expect(messages[0].toolResults![0].toolUseId).toBe("tool-1");
      expect(messages[0].toolResults![0].status).toBe("error");
      expect(messages[0].toolResults![1].toolUseId).toBe("tool-2");
      expect(messages[0].toolResults![1].status).toBe("success");
    });

    it("should handle tool results without status (backward compat)", async () => {
      const store = new SqliteCheckpointStore();
      const session = await store.createSession("/test/dir");
      const toolResults = [{ content: "old format result", toolUseId: "tool-1" }];

      await store.addMessage(session.id, {
        content: "Old Tool Result",
        role: "tool",
        sessionId: session.id,
        toolResults,
      });

      const messages = await store.getMessages(session.id);

      expect(messages).toHaveLength(1);
      expect(messages[0].toolResults![0].toolUseId).toBe("tool-1");
      expect(messages[0].toolResults![0].status).toBeUndefined();
    });
  });

  describe("Checkpoints - Serialization", () => {
    it("should serialize and deserialize node results", async () => {
      const store = new SqliteCheckpointStore();
      const session = await store.createSession("/test/dir");
      const nodeResults = {
        node1: { output: "result", startedAt: Date.now(), status: "completed" as const },
      };

      const checkpoint = await store.saveCheckpoint({
        namespace: "default",
        nodeResults,
        pendingNodes: [],
        sessionId: session.id,
        source: "input",
        step: 0,
        version: 1,
      });

      const retrieved = await store.getCheckpoint(checkpoint.id);

      expect(retrieved?.nodeResults).toEqual(nodeResults);
    });

    it("should serialize and deserialize cycle state", async () => {
      const store = new SqliteCheckpointStore();
      const session = await store.createSession("/test/dir");
      const cycleState = { backEdge: "edge1", iteration: 3 };

      const checkpoint = await store.saveCheckpoint({
        cycleState,
        namespace: "default",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "loop",
        step: 0,
        version: 1,
      });

      const retrieved = await store.getCheckpoint(checkpoint.id);

      expect(retrieved?.cycleState).toEqual(cycleState);
    });

    it("should throw error when listing checkpoints for non-existent session", async () => {
      const store = new SqliteCheckpointStore();
      await expect(store.listCheckpoints("non-existent")).rejects.toThrow("Session not found");
    });
  });

  describe("Close", () => {
    it("should close without error", async () => {
      const store = new SqliteCheckpointStore();
      const session = await store.createSession("/test/dir");
      await store.addMessage(session.id, {
        content: "Hello",
        role: "user",
        sessionId: session.id,
      });

      await store.close();
    });
  });

  describe("Edge Cases - Extra", () => {
    it("should handle checkpoint with nodeId", async () => {
      const store = new SqliteCheckpointStore();
      const session = await store.createSession("/test/dir");
      const checkpoint = await store.saveCheckpoint({
        namespace: "default",
        nodeId: "node-123",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "input",
        step: 0,
        version: 1,
      });

      expect(checkpoint.nodeId).toBe("node-123");
    });

    it("should handle metadata with complex types", async () => {
      const store = new SqliteCheckpointStore();
      const session = await store.createSession("/test/dir", {
        metadata: {
          buffer: Buffer.from("test"),
          date: new Date("2024-01-01"),
          map: new Map([["key", "value"]]),
          set: new Set([1, 2, 3]),
        },
      });

      const retrieved = await store.getSession(session.id);

      expect(retrieved?.metadata?.date).toBeInstanceOf(Date);
      expect(retrieved?.metadata?.map).toBeInstanceOf(Map);
      expect(retrieved?.metadata?.set).toBeInstanceOf(Set);
      expect(Buffer.isBuffer(retrieved?.metadata?.buffer)).toBe(true);
      expect(retrieved?.metadata?.date.toISOString()).toBe("2024-01-01T00:00:00.000Z");
      const map = retrieved!.metadata!.map as Map<string, string>;
      expect(map.get("key")).toBe("value");
    });

    describe("File Persistence", () => {
      it("should persist data across close and reopen", async () => {
        const dbPath = join(tmpdir(), `test-checkpoint-${Date.now()}.db`);

        try {
          const store1 = new SqliteCheckpointStore(dbPath);
          const session = await store1.createSession("/test/dir", { title: "Persistent" });
          await store1.addMessage(session.id, {
            content: "Persistent message",
            role: "user",
            sessionId: session.id,
          });
          await store1.saveCheckpoint({
            namespace: "default",
            nodeResults: {},
            pendingNodes: [],
            sessionId: session.id,
            source: "input",
            step: 0,
            version: 1,
          });
          await store1.close();

          const store2 = new SqliteCheckpointStore(dbPath);
          const retrievedSession = await store2.getSession(session.id);
          const messages = await store2.getMessages(session.id);
          const checkpoints = await store2.listCheckpoints(session.id);

          expect(retrievedSession?.title).toBe("Persistent");
          expect(messages).toHaveLength(1);
          expect(messages[0].content).toBe("Persistent message");
          expect(checkpoints).toHaveLength(1);

          await store2.close();
        } finally {
          if (existsSync(dbPath)) {
            unlinkSync(dbPath);
          }
        }
      });
    });

    describe("Concurrent Access", () => {
      it("should handle concurrent writes from different instances", async () => {
        const dbPath = join(tmpdir(), `test-concurrent-${Date.now()}.db`);

        try {
          const store1 = new SqliteCheckpointStore(dbPath);
          const store2 = new SqliteCheckpointStore(dbPath);

          const _session1 = await store1.createSession("/dir1", { title: "From Store 1" });
          const _session2 = await store2.createSession("/dir2", { title: "From Store 2" });

          const sessions1 = await store1.listSessions();
          const sessions2 = await store2.listSessions();

          expect(sessions1).toHaveLength(2);
          expect(sessions2).toHaveLength(2);

          await store1.close();
          await store2.close();
        } finally {
          if (existsSync(dbPath)) {
            unlinkSync(dbPath);
          }
        }
      });
    });

    describe("Large State", () => {
      it("should handle large node results", async () => {
        const store = new SqliteCheckpointStore();
        const session = await store.createSession("/test/dir");
        const largeNodeResults: Record<string, { output: string; status: "completed" }> = {};

        for (let i = 0; i < 100; i++) {
          largeNodeResults[`node${i}`] = {
            output: "x".repeat(1000),
            status: "completed",
          };
        }

        const checkpoint = await store.saveCheckpoint({
          namespace: "default",
          nodeResults: largeNodeResults,
          pendingNodes: [],
          sessionId: session.id,
          source: "input",
          step: 0,
          version: 1,
        });

        const retrieved = await store.getCheckpoint(checkpoint.id);

        expect(Object.keys(retrieved?.nodeResults ?? {})).toHaveLength(100);
        expect(retrieved?.nodeResults.node0.output).toHaveLength(1000);
      });
    });
  });
});
