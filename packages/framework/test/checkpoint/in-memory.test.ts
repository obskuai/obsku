import { describe, expect, it } from "bun:test";
import { InMemoryCheckpointStore } from "../../src/checkpoint/in-memory";
import { runStoreTests } from "./shared/store-tests";

runStoreTests({
  createStore: () => ({ store: new InMemoryCheckpointStore() }),
  description: "InMemoryCheckpointStore",
});

describe("InMemoryCheckpointStore - Backend Specific", () => {
  describe("Close", () => {
    it("should clear all data on close", async () => {
      const store = new InMemoryCheckpointStore();
      const session = await store.createSession("/test/dir");
      await store.addMessage(session.id, {
        content: "Hello",
        role: "user",
        sessionId: session.id,
      });
      await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "input",
        step: 0,
        version: 1,
      });

      await store.close();

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe("Session Delete (basic)", () => {
    it("should delete a session", async () => {
      const store = new InMemoryCheckpointStore();
      const session = await store.createSession("/test/dir");
      await store.deleteSession(session.id);

      const retrieved = await store.getSession(session.id);
      expect(retrieved).toBeNull();
    });
  });

  describe("Checkpoints (extra)", () => {
    it("should throw error when listing checkpoints for non-existent session", async () => {
      const store = new InMemoryCheckpointStore();
      await expect(store.listCheckpoints("non-existent")).rejects.toThrow("Session not found");
    });
  });

  describe("Edge Cases (extra)", () => {
    it("should handle checkpoint with nodeId", async () => {
      const store = new InMemoryCheckpointStore();
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
  });
});
