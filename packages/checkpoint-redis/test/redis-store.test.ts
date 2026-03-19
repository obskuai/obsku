import { describe, expect, it } from "bun:test";
import { runStoreTests } from "./framework-shared-test-helpers";
import { RedisCheckpointStore } from "../src/redis-store";

const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("RedisCheckpointStore", () => {
  runStoreTests({
    createStore: () => {
      const prefix = `test:${Date.now()}:${Math.random().toString(36).slice(2)}:`;
      const store = new RedisCheckpointStore({ prefix, url: REDIS_URL! });
      return {
        cleanup: async () => {
          await store.close();
        },
        store,
      };
    },
    description: "RedisCheckpointStore",
  });

  describe("Redis Backend Specific", () => {
    describe("Concurrency", () => {
      it("should handle concurrent checkpoint saves with different versions", async () => {
        const prefix = `test:${Date.now()}:conc:`;
        const store = new RedisCheckpointStore({ prefix, url: REDIS_URL! });
        const session = await store.createSession("/test/dir");

        const promises = [1, 2, 3, 4, 5].map((version) =>
          store.saveCheckpoint({
            namespace: "default",
            nodeResults: {},
            pendingNodes: [],
            sessionId: session.id,
            source: "loop",
            step: version - 1,
            version,
          })
        );

        const checkpoints = await Promise.all(promises);

        expect(checkpoints).toHaveLength(5);
        expect(new Set(checkpoints.map((c) => c.id)).size).toBe(5);

        await store.close();
      });
    });

    describe("Messages - Serialization", () => {
      it("should serialize and deserialize tool calls", async () => {
        const prefix = `test:${Date.now()}:ser:`;
        const store = new RedisCheckpointStore({ prefix, url: REDIS_URL! });
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

        await store.close();
      });

      it("should serialize and deserialize tool results with status", async () => {
        const prefix = `test:${Date.now()}:status:`;
        const store = new RedisCheckpointStore({ prefix, url: REDIS_URL! });
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
        const prefix = `test:${Date.now()}:compat:`;
        const store = new RedisCheckpointStore({ prefix, url: REDIS_URL! });
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

    describe("Checkpoints - Serialization", () => {
      it("should serialize and deserialize node results with complex types", async () => {
        const prefix = `test:${Date.now()}:nr:`;
        const store = new RedisCheckpointStore({ prefix, url: REDIS_URL! });
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

        await store.close();
      });
    });

    describe("Edge Cases", () => {
      it("should handle metadata with complex types", async () => {
        const prefix = `test:${Date.now()}:meta:`;
        const store = new RedisCheckpointStore({ prefix, url: REDIS_URL! });
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

        await store.close();
      });
    });

    describe("Close", () => {
      it("should close without error", async () => {
        const prefix = `test:${Date.now()}:close:`;
        const store = new RedisCheckpointStore({ prefix, url: REDIS_URL! });
        const session = await store.createSession("/test/dir");
        await store.addMessage(session.id, {
          content: "Hello",
          role: "user",
          sessionId: session.id,
        });

        await store.close();
      });
    });
  });
});
