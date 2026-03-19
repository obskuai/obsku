import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { CheckpointStore } from "../../../src/checkpoint/types";

export type StoreContext = {
  cleanup?: () => Promise<void>;
  store: CheckpointStore;
};

export type StoreTestOptions = {
  afterEach?: () => Promise<void>;
  createStore: () => Promise<StoreContext> | StoreContext;
  description?: string;
};

export function runStoreTests(options: StoreTestOptions): void {
  let store: CheckpointStore;
  let cleanup: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const ctx = await options.createStore();
    store = ctx.store;
    cleanup = ctx.cleanup;
  });

  afterEach(async () => {
    await cleanup?.();
    await options.afterEach?.();
  });

  // ---------------------------------------------------------------------------
  // Session CRUD (9 tests)
  // ---------------------------------------------------------------------------
  describe("Session CRUD", () => {
    it("should create a session with required fields", async () => {
      const session = await store.createSession("/test/dir");

      expect(session.id).toBeDefined();
      expect(session.directory).toBe("/test/dir");
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBeDefined();
      expect(session.createdAt).toBe(session.updatedAt);
    });

    it("should create a session with optional fields", async () => {
      const session = await store.createSession("/test/dir", {
        metadata: { key: "value" },
        title: "Test Session",
        workspaceId: "ws-123",
      });

      expect(session.title).toBe("Test Session");
      expect(session.workspaceId).toBe("ws-123");
      expect(session.metadata).toEqual({ key: "value" });
    });

    it("should get a session by ID", async () => {
      const session = await store.createSession("/test/dir");
      const retrieved = await store.getSession(session.id);

      expect(retrieved).toEqual(session);
    });

    it("should return null for non-existent session", async () => {
      const retrieved = await store.getSession("non-existent-id");
      expect(retrieved).toBeNull();
    });

    it("should list all sessions", async () => {
      const session1 = await store.createSession("/dir1");
      const session2 = await store.createSession("/dir2");

      const sessions = await store.listSessions();

      // Postgres-compatible: shared DB may have leftover sessions
      expect(sessions.length).toBeGreaterThanOrEqual(2);
      const sessionIds = sessions.map((s) => s.id);
      expect(sessionIds).toContain(session1.id);
      expect(sessionIds).toContain(session2.id);
    });

    it("should list sessions filtered by workspaceId", async () => {
      const wsId = `ws-${Date.now()}`;
      const session1 = await store.createSession("/dir1", { workspaceId: wsId });
      await store.createSession("/dir2", { workspaceId: "other-ws" });
      await store.createSession("/dir3");

      const wsSessions = await store.listSessions(wsId);

      expect(wsSessions).toHaveLength(1);
      expect(wsSessions[0].id).toBe(session1.id);
    });

    it("should update a session", async () => {
      const session = await store.createSession("/test/dir");
      const originalUpdatedAt = session.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));
      await store.updateSession(session.id, { title: "Updated Title" });

      const updated = await store.getSession(session.id);
      expect(updated?.title).toBe("Updated Title");
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it("should throw error when updating non-existent session", async () => {
      await expect(store.updateSession("non-existent", { title: "Test" })).rejects.toThrow(
        "Session not found"
      );
    });

    it("should delete a session and cascade messages", async () => {
      const session = await store.createSession("/test/dir");
      await store.addMessage(session.id, {
        content: "Hello",
        role: "user",
        sessionId: session.id,
      });

      await store.deleteSession(session.id);

      const retrieved = await store.getSession(session.id);
      expect(retrieved).toBeNull();

      await expect(store.getMessages(session.id)).rejects.toThrow("Session not found");
    });
  });

  // ---------------------------------------------------------------------------
  // Messages (7 tests)
  // ---------------------------------------------------------------------------
  describe("Messages", () => {
    it("should add a message to a session", async () => {
      const session = await store.createSession("/test/dir");
      const message = await store.addMessage(session.id, {
        content: "Hello",
        role: "user",
        sessionId: session.id,
      });

      expect(message.id).toBeDefined();
      expect(message.role).toBe("user");
      expect(message.content).toBe("Hello");
      expect(message.createdAt).toBeDefined();
    });

    it("should auto-increment message IDs", async () => {
      const session = await store.createSession("/test/dir");

      const msg1 = await store.addMessage(session.id, {
        content: "First",
        role: "user",
        sessionId: session.id,
      });
      const msg2 = await store.addMessage(session.id, {
        content: "Second",
        role: "assistant",
        sessionId: session.id,
      });

      // Postgres SERIAL compatible — IDs are globally sequential
      expect(msg2.id).toBeGreaterThan(msg1.id);
    });

    it("should throw error when adding message to non-existent session", async () => {
      await expect(
        store.addMessage("non-existent", {
          content: "Hello",
          role: "user",
          sessionId: "non-existent",
        })
      ).rejects.toThrow("Session not found");
    });

    it("should get messages for a session", async () => {
      const session = await store.createSession("/test/dir");
      await store.addMessage(session.id, {
        content: "Hello",
        role: "user",
        sessionId: session.id,
      });
      await store.addMessage(session.id, {
        content: "Hi there",
        role: "assistant",
        sessionId: session.id,
      });

      const messages = await store.getMessages(session.id);

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");
    });

    it("should get messages with limit", async () => {
      const session = await store.createSession("/test/dir");
      await store.addMessage(session.id, {
        content: "First",
        role: "user",
        sessionId: session.id,
      });
      await store.addMessage(session.id, {
        content: "Second",
        role: "assistant",
        sessionId: session.id,
      });
      await store.addMessage(session.id, {
        content: "Third",
        role: "user",
        sessionId: session.id,
      });

      const messages = await store.getMessages(session.id, { limit: 2 });

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("Second");
      expect(messages[1].content).toBe("Third");
    });

    it("should get messages before timestamp", async () => {
      const session = await store.createSession("/test/dir");
      await store.addMessage(session.id, {
        content: "First",
        role: "user",
        sessionId: session.id,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const cutoff = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await store.addMessage(session.id, {
        content: "Second",
        role: "assistant",
        sessionId: session.id,
      });

      const messages = await store.getMessages(session.id, { before: cutoff });

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("First");
    });

    it("should update session updatedAt when adding message", async () => {
      const session = await store.createSession("/test/dir");
      const originalUpdatedAt = session.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 50));
      await store.addMessage(session.id, {
        content: "Hello",
        role: "user",
        sessionId: session.id,
      });

      const updated = await store.getSession(session.id);
      expect(updated?.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  // ---------------------------------------------------------------------------
  // Checkpoints (9 tests)
  // ---------------------------------------------------------------------------
  describe("Checkpoints", () => {
    it("should save a checkpoint", async () => {
      const session = await store.createSession("/test/dir");
      const checkpoint = await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        pendingNodes: ["node1"],
        sessionId: session.id,
        source: "input",
        step: 0,
        version: 1,
      });

      expect(checkpoint.id).toBeDefined();
      expect(checkpoint.sessionId).toBe(session.id);
      expect(checkpoint.namespace).toBe("default");
      expect(checkpoint.createdAt).toBeDefined();
    });

    it("should get a checkpoint by ID", async () => {
      const session = await store.createSession("/test/dir");
      const checkpoint = await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "input",
        step: 0,
        version: 1,
      });

      const retrieved = await store.getCheckpoint(checkpoint.id);

      expect(retrieved).toEqual(checkpoint);
    });

    it("should return null for non-existent checkpoint", async () => {
      const retrieved = await store.getCheckpoint("non-existent");
      expect(retrieved).toBeNull();
    });

    it("should get latest checkpoint for session", async () => {
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
      await new Promise((resolve) => setTimeout(resolve, 50));
      const latest = await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "loop",
        step: 1,
        version: 2,
      });

      const retrieved = await store.getLatestCheckpoint(session.id);

      expect(retrieved?.id).toBe(latest.id);
      expect(retrieved?.version).toBe(2);
    });

    it("should get latest checkpoint filtered by namespace", async () => {
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
      await new Promise((resolve) => setTimeout(resolve, 50));
      await store.saveCheckpoint({
        namespace: "ns2",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "input",
        step: 0,
        version: 1,
      });

      const retrieved = await store.getLatestCheckpoint(session.id, "ns1");

      expect(retrieved?.namespace).toBe("ns1");
    });

    it("should return null for getLatestCheckpoint when session has no checkpoints", async () => {
      const session = await store.createSession("/test/dir");
      const retrieved = await store.getLatestCheckpoint(session.id);
      expect(retrieved).toBeNull();
    });

    it("should list checkpoints with limit", async () => {
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
      await new Promise((resolve) => setTimeout(resolve, 50));
      await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "loop",
        step: 1,
        version: 2,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "loop",
        step: 2,
        version: 3,
      });

      const checkpoints = await store.listCheckpoints(session.id, { limit: 2 });

      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0].version).toBe(3);
      expect(checkpoints[1].version).toBe(2);
    });

    it("should list checkpoints filtered by namespace", async () => {
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
      await store.saveCheckpoint({
        namespace: "ns2",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "input",
        step: 0,
        version: 1,
      });

      const checkpoints = await store.listCheckpoints(session.id, {
        namespace: "ns1",
      });

      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].namespace).toBe("ns1");
    });

    it("should throw error when saving checkpoint for non-existent session", async () => {
      await expect(
        store.saveCheckpoint({
          namespace: "default",
          nodeResults: {},
          pendingNodes: [],
          sessionId: "non-existent",
          source: "input",
          step: 0,
          version: 1,
        })
      ).rejects.toThrow("Session not found");
    });
  });

  // ---------------------------------------------------------------------------
  // Fork (5 tests)
  // ---------------------------------------------------------------------------
  describe("Fork", () => {
    it("should fork a session from checkpoint", async () => {
      const session = await store.createSession("/test/dir", {
        title: "Original",
        workspaceId: "ws-1",
      });
      await store.addMessage(session.id, {
        content: "Hello",
        role: "user",
        sessionId: session.id,
      });
      await store.addMessage(session.id, {
        content: "Hi",
        role: "assistant",
        sessionId: session.id,
      });
      const checkpoint = await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "input",
        step: 0,
        version: 1,
      });

      const forkedSession = await store.fork(checkpoint.id);

      expect(forkedSession.id).not.toBe(session.id);
      expect(forkedSession.directory).toBe(session.directory);
      expect(forkedSession.workspaceId).toBe(session.workspaceId);
      expect(forkedSession.title).toBe("Fork of Original");
    });

    it("should copy messages up to checkpoint when forking", async () => {
      const session = await store.createSession("/test/dir");
      await store.addMessage(session.id, {
        content: "First",
        role: "user",
        sessionId: session.id,
      });
      const checkpoint = await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "input",
        step: 0,
        version: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await store.addMessage(session.id, {
        content: "Second",
        role: "assistant",
        sessionId: session.id,
      });

      const forkedSession = await store.fork(checkpoint.id);
      const forkedMessages = await store.getMessages(forkedSession.id);

      expect(forkedMessages).toHaveLength(1);
      expect(forkedMessages[0].content).toBe("First");
    });

    it("should create initial checkpoint in forked session", async () => {
      const session = await store.createSession("/test/dir");
      const checkpoint = await store.saveCheckpoint({
        namespace: "default",
        nodeResults: { node1: { status: "completed" } },
        pendingNodes: ["node2"],
        sessionId: session.id,
        source: "input",
        step: 0,
        version: 1,
      });

      const forkedSession = await store.fork(checkpoint.id);
      const forkedCheckpoints = await store.listCheckpoints(forkedSession.id);

      expect(forkedCheckpoints).toHaveLength(1);
      expect(forkedCheckpoints[0].parentId).toBe(checkpoint.id);
      expect(forkedCheckpoints[0].source).toBe("fork");
    });

    it("should throw error when forking non-existent checkpoint", async () => {
      await expect(store.fork("non-existent")).rejects.toThrow("Checkpoint not found");
    });

    it("should use custom title when forking", async () => {
      const session = await store.createSession("/test/dir", { title: "Original" });
      const checkpoint = await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "input",
        step: 0,
        version: 1,
      });

      const forkedSession = await store.fork(checkpoint.id, {
        title: "Custom Fork Title",
      });

      expect(forkedSession.title).toBe("Custom Fork Title");
    });
  });

  // ---------------------------------------------------------------------------
  // Edge Cases (7 tests)
  // ---------------------------------------------------------------------------
  describe("Edge Cases", () => {
    it("should handle empty message list", async () => {
      const session = await store.createSession("/test/dir");
      const messages = await store.getMessages(session.id);

      expect(messages).toEqual([]);
    });

    it("should handle empty checkpoint list", async () => {
      const session = await store.createSession("/test/dir");
      const checkpoints = await store.listCheckpoints(session.id);

      expect(checkpoints).toEqual([]);
    });

    it("should isolate sessions - messages don't leak between sessions", async () => {
      const session1 = await store.createSession("/dir1");
      const session2 = await store.createSession("/dir2");

      await store.addMessage(session1.id, {
        content: "Session 1 message",
        role: "user",
        sessionId: session1.id,
      });
      await store.addMessage(session2.id, {
        content: "Session 2 message",
        role: "user",
        sessionId: session2.id,
      });

      const messages1 = await store.getMessages(session1.id);
      const messages2 = await store.getMessages(session2.id);

      expect(messages1).toHaveLength(1);
      expect(messages1[0].content).toBe("Session 1 message");
      expect(messages2).toHaveLength(1);
      expect(messages2[0].content).toBe("Session 2 message");
    });

    it("should isolate sessions - checkpoints don't leak between sessions", async () => {
      const session1 = await store.createSession("/dir1");
      const session2 = await store.createSession("/dir2");

      await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session1.id,
        source: "input",
        step: 0,
        version: 1,
      });

      const checkpoints1 = await store.listCheckpoints(session1.id);
      const checkpoints2 = await store.listCheckpoints(session2.id);

      expect(checkpoints1).toHaveLength(1);
      expect(checkpoints2).toHaveLength(0);
    });

    it("should return null for getLatestCheckpoint with non-existent session", async () => {
      const result = await store.getLatestCheckpoint("non-existent");
      expect(result).toBeNull();
    });

    it("should handle checkpoint with parentId", async () => {
      const session = await store.createSession("/test/dir");
      const parent = await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "input",
        step: 0,
        version: 1,
      });
      const child = await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        parentId: parent.id,
        pendingNodes: [],
        sessionId: session.id,
        source: "loop",
        step: 1,
        version: 2,
      });

      expect(child.parentId).toBe(parent.id);
    });

    it("should handle checkpoint with cycleState and nodeId", async () => {
      const session = await store.createSession("/test/dir");
      const checkpoint = await store.saveCheckpoint({
        cycleState: {
          backEdge: "edge1",
          iteration: 3,
        },
        namespace: "default",
        nodeId: "node-123",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "loop",
        step: 0,
        version: 1,
      });

      const retrieved = await store.getCheckpoint(checkpoint.id);
      expect(retrieved?.cycleState).toEqual({
        backEdge: "edge1",
        iteration: 3,
      });
      expect(retrieved?.nodeId).toBe("node-123");
    });
  });
}
