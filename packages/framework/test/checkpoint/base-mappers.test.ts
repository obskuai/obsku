import { describe, expect, it } from "bun:test";
import {
  mapCheckpointRow,
  mapEntityRow,
  mapFactRow,
  mapMessageRow,
  mapSessionRow,
} from "../../src/checkpoint/ops/base-mappers";
import { JsonPlusSerializer } from "../../src/checkpoint/serializer";

describe("base-mappers", () => {
  const serializer = new JsonPlusSerializer();

  describe("parseEmbedding via mapEntityRow", () => {
    it("should parse valid embedding string", () => {
      const embedding = [0.1, 0.2, 0.3];
      const row = {
        createdAt: Date.now(),
        embedding: JSON.stringify(embedding),
        id: "ent-1",
        name: "Test Entity",
        sessionId: "session-1",
        type: "test",
        updatedAt: Date.now(),
      };
      const entity = mapEntityRow(serializer, row);
      expect(entity.embedding).toEqual(embedding);
    });

    it("should handle number array embedding", () => {
      const embedding = [0.1, 0.2, 0.3];
      const row = {
        createdAt: Date.now(),
        embedding,
        id: "ent-1",
        name: "Test Entity",
        sessionId: "session-1",
        type: "test",
        updatedAt: Date.now(),
      };
      const entity = mapEntityRow(serializer, row);
      expect(entity.embedding).toEqual(embedding);
    });

    it("should return undefined for null embedding", () => {
      const row = {
        createdAt: Date.now(),
        embedding: null,
        id: "ent-1",
        name: "Test Entity",
        sessionId: "session-1",
        type: "test",
        updatedAt: Date.now(),
      };
      const entity = mapEntityRow(serializer, row);
      expect(entity.embedding).toBeUndefined();
    });

    it("should return undefined for undefined embedding", () => {
      const row = {
        createdAt: Date.now(),
        id: "ent-1",
        name: "Test Entity",
        sessionId: "session-1",
        type: "test",
        updatedAt: Date.now(),
      };
      const entity = mapEntityRow(serializer, row);
      expect(entity.embedding).toBeUndefined();
    });

    it("should return undefined for invalid JSON string (not an array)", () => {
      const row = {
        createdAt: Date.now(),
        embedding: '"not an array"',
        id: "ent-1",
        name: "Test Entity",
        sessionId: "session-1",
        type: "test",
        updatedAt: Date.now(),
      };
      const entity = mapEntityRow(serializer, row);
      expect(entity.embedding).toBeUndefined();
    });

    it("should return undefined for array with non-numeric values", () => {
      const row = {
        createdAt: Date.now(),
        embedding: '["not", "numbers"]',
        id: "ent-1",
        name: "Test Entity",
        sessionId: "session-1",
        type: "test",
        updatedAt: Date.now(),
      };
      const entity = mapEntityRow(serializer, row);
      expect(entity.embedding).toBeUndefined();
    });

    it("should return undefined for invalid JSON syntax", () => {
      const row = {
        createdAt: Date.now(),
        embedding: "not valid json",
        id: "ent-1",
        name: "Test Entity",
        sessionId: "session-1",
        type: "test",
        updatedAt: Date.now(),
      };
      const entity = mapEntityRow(serializer, row);
      expect(entity.embedding).toBeUndefined();
    });

    it("should handle snake_case column names", () => {
      const embedding = [0.1, 0.2, 0.3];
      const row = {
        created_at: Date.now(),
        embedding: JSON.stringify(embedding),
        id: "ent-1",
        name: "Test Entity",
        session_id: "session-1",
        type: "test",
        updated_at: Date.now(),
        workspace_id: null,
      };
      const entity = mapEntityRow(serializer, row);
      expect(entity.embedding).toEqual(embedding);
      expect(entity.sessionId).toBe("session-1");
    });
  });

  describe("parseEmbedding via mapFactRow", () => {
    it("should parse valid embedding string", () => {
      const embedding = [0.4, 0.5, 0.6];
      const row = {
        confidence: 0.9,
        content: "Test fact",
        createdAt: Date.now(),
        embedding: JSON.stringify(embedding),
        id: "fact-1",
      };
      const fact = mapFactRow(row);
      expect(fact.embedding).toEqual(embedding);
    });

    it("should return undefined for invalid JSON string", () => {
      const row = {
        confidence: 0.9,
        content: "Test fact",
        createdAt: Date.now(),
        embedding: "not valid json",
        id: "fact-1",
      };
      const fact = mapFactRow(row);
      expect(fact.embedding).toBeUndefined();
    });

    it("should return undefined for array with mixed types", () => {
      const row = {
        confidence: 0.9,
        content: "Test fact",
        createdAt: Date.now(),
        embedding: '[1, 2, "three"]',
        id: "fact-1",
      };
      const fact = mapFactRow(row);
      expect(fact.embedding).toBeUndefined();
    });
  });

  describe("split mapper compatibility regressions", () => {
    it("should coerce snake_case message numeric columns and deserialize tool payloads", () => {
      const toolCalls = [{ input: { query: "test" }, name: "search", toolUseId: "tool-1" }];
      const toolResults = [{ content: "ok", status: "completed", toolUseId: "tool-1" }];

      const message = mapMessageRow(serializer, {
        content: null,
        created_at: "123",
        id: 7,
        role: "assistant",
        session_id: 99 as never,
        tokens_in: 11,
        tokens_out: 22,
        tool_calls: serializer.serialize(toolCalls),
        tool_results: serializer.serialize(toolResults),
      });

      expect(message).toEqual({
        content: undefined,
        createdAt: 123,
        id: 7,
        role: "assistant",
        sessionId: "99",
        tokensIn: 11,
        tokensOut: 22,
        toolCalls,
        toolResults,
      });
    });

    it("should preserve camelCase session metadata objects and coerce numeric timestamps", () => {
      const metadata = { nested: { enabled: true }, tags: ["a", "b"] };

      const session = mapSessionRow(serializer, {
        createdAt: "100",
        directory: "/tmp/demo",
        id: "sess-1",
        metadata,
        title: null,
        updatedAt: "101",
        workspaceId: "ws-1",
      });

      expect(session).toEqual({
        createdAt: 100,
        directory: "/tmp/demo",
        id: "sess-1",
        metadata,
        title: undefined,
        updatedAt: 101,
        workspaceId: "ws-1",
      });
    });

    it("should map snake_case checkpoint payloads with serialized optional fields", () => {
      const checkpoint = mapCheckpointRow(serializer, {
        created_at: "200",
        cycle_state: serializer.serialize({ backEdge: "retry", iteration: 2 }),
        id: "cp-1",
        namespace: "default",
        node_id: null,
        node_results: serializer.serialize({
          worker: { output: { ok: true }, status: "completed" },
        }),
        parent_id: null,
        pending_nodes: serializer.serialize(["summarize"]),
        session_id: 55 as never,
        source: "loop",
        step: 3,
        version: 4,
      });

      expect(checkpoint).toEqual({
        createdAt: 200,
        cycleState: { backEdge: "retry", iteration: 2 },
        id: "cp-1",
        namespace: "default",
        nodeId: undefined,
        nodeResults: { worker: { output: { ok: true }, status: "completed" } },
        parentId: undefined,
        pendingNodes: ["summarize"],
        sessionId: "55",
        source: "loop",
        step: 3,
        version: 4,
      });
    });

    it("should keep checkpoint fallback defaults when optional serialized fields are absent", () => {
      const checkpoint = mapCheckpointRow(serializer, {
        createdAt: 201,
        id: "cp-2",
        namespace: "default",
        sessionId: "sess-2",
        source: "input",
        step: 1,
        version: 1,
      });

      expect(checkpoint.nodeResults).toEqual({});
      expect(checkpoint.pendingNodes).toEqual([]);
      expect(checkpoint.cycleState).toBeUndefined();
    });
  });
});
