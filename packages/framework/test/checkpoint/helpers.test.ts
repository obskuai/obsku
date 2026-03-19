import { beforeEach, describe, expect, it } from "bun:test";
import { CheckpointStoreHelpers } from "../../src/checkpoint/helpers";
import { InMemoryCheckpointStore } from "../../src/checkpoint/in-memory";
import type { Session } from "../../src/checkpoint/types";

describe("CheckpointStoreHelpers", () => {
  let store: InMemoryCheckpointStore;
  let helpers: CheckpointStoreHelpers;

  beforeEach(() => {
    store = new InMemoryCheckpointStore();
    helpers = new CheckpointStoreHelpers(store);
  });

  describe("continueLatest", () => {
    it("should return most recent session with messages and checkpoint", async () => {
      // Create first session (older)
      const session1 = await store.createSession("/workspace/project1", {
        title: "First Session",
        workspaceId: "ws-1",
      });
      await store.addMessage(session1.id, {
        content: "Hello",
        role: "user",
        sessionId: session1.id,
      });

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Create second session (newer)
      const session2 = await store.createSession("/workspace/project2", {
        title: "Second Session",
        workspaceId: "ws-1",
      });
      await store.addMessage(session2.id, {
        content: "World",
        role: "user",
        sessionId: session2.id,
      });
      const checkpoint2 = await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session2.id,
        source: "input",
        step: 1,
        version: 1,
      });

      const result = await helpers.continueLatest("ws-1");

      expect(result).not.toBeNull();
      expect(result!.session.id).toBe(session2.id);
      expect(result!.session.title).toBe("Second Session");
      expect(result!.messages).toHaveLength(1);
      expect(result!.messages[0].content).toBe("World");
      expect(result!.checkpoint).not.toBeNull();
      expect(result!.checkpoint!.id).toBe(checkpoint2.id);
    });

    it("should return null when no sessions exist", async () => {
      const result = await helpers.continueLatest();
      expect(result).toBeNull();
    });

    it("should return null when no sessions exist for workspace", async () => {
      await store.createSession("/workspace/project", {
        title: "Session",
        workspaceId: "ws-1",
      });

      const result = await helpers.continueLatest("ws-2");
      expect(result).toBeNull();
    });

    it("should return session without checkpoint when no checkpoints exist", async () => {
      const session = await store.createSession("/workspace/project", {
        title: "Session without checkpoint",
      });
      await store.addMessage(session.id, {
        content: "Test",
        role: "user",
        sessionId: session.id,
      });

      const result = await helpers.continueLatest();

      expect(result).not.toBeNull();
      expect(result!.session.id).toBe(session.id);
      expect(result!.messages).toHaveLength(1);
      expect(result!.checkpoint).toBeNull();
    });
  });

  describe("searchSessions", () => {
    let session1: Session;
    let session2: Session;
    let session3: Session;

    beforeEach(async () => {
      session1 = await store.createSession("/workspace/alpha", {
        title: "Alpha Project",
        workspaceId: "ws-1",
      });
      session2 = await store.createSession("/workspace/beta", {
        title: "Beta Testing",
        workspaceId: "ws-1",
      });
      session3 = await store.createSession("/workspace/gamma", {
        title: "Gamma Ray",
        workspaceId: "ws-2",
      });
    });

    it("should match sessions by title", async () => {
      const results = await helpers.searchSessions("Alpha");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(session1.id);
    });

    it("should match sessions by directory", async () => {
      const results = await helpers.searchSessions("beta");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(session2.id);
    });

    it("should match sessions by ID", async () => {
      const results = await helpers.searchSessions(session3.id.slice(0, 8));
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(session3.id);
    });

    it("should be case-insensitive", async () => {
      const results = await helpers.searchSessions("ALPHA");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(session1.id);
    });

    it("should filter by workspaceId", async () => {
      const results = await helpers.searchSessions("Project", "ws-1");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(session1.id);
    });

    it("should return multiple matches", async () => {
      const results = await helpers.searchSessions("a");
      // All three have 'a' in title or directory
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("should return empty array when no matches", async () => {
      const results = await helpers.searchSessions("nonexistent");
      expect(results).toHaveLength(0);
    });
  });

  describe("getSessionSummary", () => {
    it("should return correct counts and duration", async () => {
      const session = await store.createSession("/workspace/project", {
        title: "Test Session",
      });

      // Add messages
      await store.addMessage(session.id, {
        content: "Message 1",
        role: "user",
        sessionId: session.id,
      });
      await store.addMessage(session.id, {
        content: "Response 1",
        role: "assistant",
        sessionId: session.id,
      });

      // Add checkpoints
      await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "input",
        step: 1,
        version: 1,
      });
      await store.saveCheckpoint({
        namespace: "default",
        nodeResults: {},
        pendingNodes: [],
        sessionId: session.id,
        source: "loop",
        step: 2,
        version: 2,
      });

      const summary = await helpers.getSessionSummary(session.id);

      expect(summary).not.toBeNull();
      expect(summary!.session.id).toBe(session.id);
      expect(summary!.messageCount).toBe(2);
      expect(summary!.lastMessage).not.toBeNull();
      expect(summary!.lastMessage!.role).toBe("user");
      expect(summary!.checkpointCount).toBe(2);
      expect(summary!.duration).toBeGreaterThanOrEqual(0);
    });

    it("should return null for non-existent session", async () => {
      const summary = await helpers.getSessionSummary("non-existent-id");
      expect(summary).toBeNull();
    });

    it("should handle session with no messages", async () => {
      const session = await store.createSession("/workspace/project");

      const summary = await helpers.getSessionSummary(session.id);

      expect(summary).not.toBeNull();
      expect(summary!.messageCount).toBe(0);
      expect(summary!.lastMessage).toBeNull();
      expect(summary!.checkpointCount).toBe(0);
    });

    it("should calculate duration correctly", async () => {
      const _beforeCreate = Date.now();
      const session = await store.createSession("/workspace/project");

      await new Promise((resolve) => setTimeout(resolve, 50));

      await store.addMessage(session.id, {
        content: "Update",
        role: "user",
        sessionId: session.id,
      });

      const summary = await helpers.getSessionSummary(session.id);

      expect(summary!.duration).toBeGreaterThanOrEqual(0);
      // Duration should be at least 50ms (our wait time)
      expect(summary!.duration).toBeGreaterThanOrEqual(40);
    });
  });

  describe("listSessionsWithSummaries", () => {
    it("should return sessions with message counts", async () => {
      const session = await store.createSession("/workspace/project", {
        title: "Test",
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

      const results = await helpers.listSessionsWithSummaries();

      expect(results).toHaveLength(1);
      expect(results[0].session.id).toBe(session.id);
      expect(results[0].messageCount).toBe(2);
      expect(results[0].lastMessageAt).not.toBeNull();
    });

    it("should respect limit parameter", async () => {
      await store.createSession("/workspace/1", { title: "Session 1" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await store.createSession("/workspace/2", { title: "Session 2" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await store.createSession("/workspace/3", { title: "Session 3" });

      const results = await helpers.listSessionsWithSummaries(undefined, 2);

      expect(results).toHaveLength(2);
    });

    it("should filter by workspaceId", async () => {
      await store.createSession("/workspace/1", {
        title: "Session 1",
        workspaceId: "ws-1",
      });
      await store.createSession("/workspace/2", {
        title: "Session 2",
        workspaceId: "ws-2",
      });

      const results = await helpers.listSessionsWithSummaries("ws-1");

      expect(results).toHaveLength(1);
      expect(results[0].session.workspaceId).toBe("ws-1");
    });

    it("should sort by updatedAt descending", async () => {
      const session1 = await store.createSession("/workspace/1", {
        title: "First",
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const session2 = await store.createSession("/workspace/2", {
        title: "Second",
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const session3 = await store.createSession("/workspace/3", {
        title: "Third",
      });

      const results = await helpers.listSessionsWithSummaries();

      expect(results).toHaveLength(3);
      expect(results[0].session.id).toBe(session3.id);
      expect(results[1].session.id).toBe(session2.id);
      expect(results[2].session.id).toBe(session1.id);
    });

    it("should handle sessions with no messages", async () => {
      await store.createSession("/workspace/project");

      const results = await helpers.listSessionsWithSummaries();

      expect(results).toHaveLength(1);
      expect(results[0].messageCount).toBe(0);
      expect(results[0].lastMessageAt).toBeNull();
    });

    it("should return empty array when no sessions", async () => {
      const results = await helpers.listSessionsWithSummaries();
      expect(results).toHaveLength(0);
    });

    it("should return empty array when workspace has no sessions", async () => {
      await store.createSession("/workspace/project", { workspaceId: "ws-1" });

      const results = await helpers.listSessionsWithSummaries("ws-2");
      expect(results).toHaveLength(0);
    });
  });
});
