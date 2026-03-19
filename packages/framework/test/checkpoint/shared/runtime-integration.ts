import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Checkpoint, CheckpointStore, TextContent } from "@obsku/framework";
import { graph } from "../../../src/graph/builder";
import type { GraphEdge, GraphNode, LLMProvider, LLMResponse } from "../../../src/index";
import { run } from "../../../src/runtime";

export interface CheckpointRuntimeIntegrationOptions {
  cleanup?: (store: CheckpointStore) => Promise<void>;
  createStore: () => Promise<CheckpointStore> | CheckpointStore;
  description: string;
  supportsMultipleCheckpoints?: boolean;
}

function mockProvider(): LLMProvider {
  return {
    chat: async (messages) => {
      const userText = messages
        .filter((m) => m.role === "user")
        .flatMap((m) => m.content)
        .filter((b): b is TextContent => b.type === "text")
        .map((b) => b.text)
        .join("");

      return {
        content: [{ text: userText, type: "text" as const }],
        stopReason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 10 },
      } satisfies LLMResponse;
    },
    chatStream: async function* () {},
    contextWindowSize: 200_000,
  };
}

function fnNode(id: string, fn: (input: unknown) => Promise<unknown>): GraphNode {
  return { executor: fn, id };
}

function edge(from: string, to: string): GraphEdge {
  return { from, to };
}

export function runCheckpointRuntimeIntegrationTests(
  options: CheckpointRuntimeIntegrationOptions
): void {
  describe(`${options.description} CheckpointStore Integration`, () => {
    let store: CheckpointStore;
    let provider: LLMProvider;

    beforeEach(async () => {
      store = await options.createStore();
      provider = mockProvider();
    });

    afterEach(async () => {
      await options.cleanup?.(store);
    });

    test("store is created properly", async () => {
      expect(store).toBeDefined();
      const session = await store.createSession("./test");
      expect(session.id).toBeDefined();
    });

    test("graph saves checkpoints during execution", async () => {
      const nodes: Array<GraphNode> = [fnNode("A", async () => "output-A")];
      const g = graph({ edges: [], entry: "A", nodes, provider });
      const session = await store.createSession("./test");

      const result = await run(g, {
        checkpointStore: store,
        namespace: "test",
        sessionId: session.id,
      });

      expect(result.status).toBe("Complete");
      const latestCheckpoint = await store.getLatestCheckpoint(session.id, "test");
      expect(latestCheckpoint).not.toBeNull();
      expect(latestCheckpoint?.sessionId).toBe(session.id);
      expect(latestCheckpoint?.namespace).toBe("test");
      expect(latestCheckpoint?.step).toBeGreaterThanOrEqual(0);
    });

    test("checkpoint has correct structure after graph execution", async () => {
      const nodes: Array<GraphNode> = [fnNode("A", async () => "output-A")];
      const g = graph({ edges: [], entry: "A", nodes, provider });
      const session = await store.createSession("./test");

      await run(g, {
        checkpointStore: store,
        namespace: "main",
        sessionId: session.id,
      });

      const checkpoint = await store.getLatestCheckpoint(session.id, "main");
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.id).toBeDefined();
      expect(checkpoint?.sessionId).toBe(session.id);
      expect(checkpoint?.namespace).toBe("main");
      expect(checkpoint?.version).toBeDefined();
      expect(checkpoint?.step).toBeDefined();
      expect(checkpoint?.nodeResults).toBeDefined();
      expect(checkpoint?.source).toBeDefined();
      expect(checkpoint?.createdAt).toBeGreaterThan(0);
    });

    test("resume from checkpoint continues execution", async () => {
      const nodes: Array<GraphNode> = [fnNode("A", async () => "output-A")];
      const g = graph({ edges: [], entry: "A", nodes, provider });
      const session = await store.createSession("./test");

      const result1 = await run(g, {
        checkpointStore: store,
        namespace: "resume-test",
        sessionId: session.id,
      });
      expect(result1.status).toBe("Complete");

      const checkpoint = await store.getLatestCheckpoint(session.id, "resume-test");
      expect(checkpoint).not.toBeNull();

      const result2 = await run(g, {
        checkpointStore: store,
        namespace: "resume-test-2",
        resumeFrom: checkpoint!,
        sessionId: session.id,
      });
      expect(result2.status).toBe("Complete");
    });

    test("fork creates new session with copied messages", async () => {
      const nodes: Array<GraphNode> = [fnNode("A", async () => "output-A")];
      const g = graph({ edges: [], entry: "A", nodes, provider });
      const session = await store.createSession("./test", { title: "Original" });

      await store.addMessage(session.id, { content: "Hello", role: "user", sessionId: session.id });
      await store.addMessage(session.id, {
        content: "Hi there",
        role: "assistant",
        sessionId: session.id,
      });

      await run(g, {
        checkpointStore: store,
        namespace: "fork-test",
        sessionId: session.id,
      });

      const checkpoint = await store.getLatestCheckpoint(session.id, "fork-test");
      expect(checkpoint).not.toBeNull();

      const forkedSession = await store.fork(checkpoint!.id, { title: "Forked Session" });
      expect(forkedSession.id).not.toBe(session.id);
      expect(forkedSession.title).toBe("Forked Session");

      const forkedMessages = await store.getMessages(forkedSession.id);
      expect(forkedMessages.length).toBeGreaterThanOrEqual(2);

      const forkedCheckpoint = await store.getLatestCheckpoint(forkedSession.id, "fork-test");
      expect(forkedCheckpoint).not.toBeNull();
      expect(forkedCheckpoint?.parentId).toBe(checkpoint!.id);
      expect(forkedCheckpoint?.source).toBe("fork");
    });

    test("multiple checkpoints per session", async () => {
      if (!options.supportsMultipleCheckpoints) {
        process.stdout.write(`Skipping multiple checkpoints test for ${options.description}\n`);
        return;
      }

      const nodes: Array<GraphNode> = [
        fnNode("A", async () => "output-A"),
        fnNode("B", async () => "output-B"),
      ];
      const g = graph({ edges: [edge("A", "B")], entry: "A", nodes, provider });
      const session = await store.createSession("./test");

      await run(g, {
        checkpointStore: store,
        namespace: "multi-checkpoint",
        sessionId: session.id,
      });
      await run(g, {
        checkpointStore: store,
        namespace: "multi-checkpoint-2",
        sessionId: session.id,
      });

      const checkpoints = await store.listCheckpoints(session.id);
      expect(checkpoints.length).toBeGreaterThanOrEqual(1);
      expect(await store.getLatestCheckpoint(session.id, "multi-checkpoint-2")).not.toBeNull();
    });

    test("checkpoint namespace isolation", async () => {
      const nodes: Array<GraphNode> = [fnNode("A", async () => "output")];
      const g = graph({ edges: [], entry: "A", nodes, provider });
      const session = await store.createSession("./test");

      await run(g, { checkpointStore: store, namespace: "ns1", sessionId: session.id });
      await run(g, { checkpointStore: store, namespace: "ns2", sessionId: session.id });

      const ns1Checkpoints = await store.listCheckpoints(session.id, { namespace: "ns1" });
      const ns2Checkpoints = await store.listCheckpoints(session.id, { namespace: "ns2" });
      expect(ns1Checkpoints.length).toBeGreaterThanOrEqual(1);
      expect(ns2Checkpoints.length).toBeGreaterThanOrEqual(1);
      expect((await store.getLatestCheckpoint(session.id, "ns1"))?.namespace).toBe("ns1");
      expect((await store.getLatestCheckpoint(session.id, "ns2"))?.namespace).toBe("ns2");
    });

    test("onCheckpoint callback fires during execution", async () => {
      const nodes: Array<GraphNode> = [fnNode("A", async () => "output-A")];
      const g = graph({ edges: [], entry: "A", nodes, provider });
      const session = await store.createSession("./test");
      const checkpointIds: Array<string> = [];

      await run(g, {
        checkpointStore: store,
        namespace: "callback-test",
        onCheckpoint: (cp: Checkpoint) => checkpointIds.push(cp.id),
        sessionId: session.id,
      });

      expect(checkpointIds.length).toBeGreaterThanOrEqual(1);
      for (const id of checkpointIds) {
        expect(await store.getCheckpoint(id)).not.toBeNull();
      }
    });

    test("checkpoint preserves node results", async () => {
      const nodes: Array<GraphNode> = [fnNode("A", async () => "result-from-A")];
      const g = graph({ edges: [], entry: "A", nodes, provider });
      const session = await store.createSession("./test");

      await run(g, { checkpointStore: store, namespace: "results-test", sessionId: session.id });

      const checkpoint = await store.getLatestCheckpoint(session.id, "results-test");
      expect(checkpoint).not.toBeNull();
      expect(Object.keys(checkpoint?.nodeResults ?? {}).length).toBeGreaterThanOrEqual(1);
    });

    test("forked session can run independently", async () => {
      const nodes: Array<GraphNode> = [fnNode("A", async () => "original-output")];
      const g = graph({ edges: [], entry: "A", nodes, provider });
      const session = await store.createSession("./test");

      await run(g, { checkpointStore: store, namespace: "fork-run-test", sessionId: session.id });
      const checkpoint = await store.getLatestCheckpoint(session.id, "fork-run-test");
      expect(checkpoint).not.toBeNull();

      const forkedSession = await store.fork(checkpoint!.id);
      const forkedResult = await run(g, {
        checkpointStore: store,
        namespace: "fork-run-test-2",
        sessionId: forkedSession.id,
      });

      expect(forkedResult.status).toBe("Complete");
      expect((await store.listCheckpoints(forkedSession.id)).length).toBeGreaterThanOrEqual(1);
    });

    test("session metadata preserved through operations", async () => {
      const nodes: Array<GraphNode> = [fnNode("A", async () => "output")];
      const g = graph({ edges: [], entry: "A", nodes, provider });
      const session = await store.createSession("./test", {
        metadata: { key: "value" },
        title: "Test Session",
        workspaceId: "workspace-123",
      });

      expect(session.title).toBe("Test Session");
      expect(session.workspaceId).toBe("workspace-123");
      expect(session.metadata).toEqual({ key: "value" });

      await run(g, { checkpointStore: store, namespace: "metadata-test", sessionId: session.id });
      expect((await store.getSession(session.id))?.title).toBe("Test Session");
    });
  });
}
