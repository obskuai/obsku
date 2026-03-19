import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  CheckpointSchema,
  EntitySchema,
  FactSchema,
  SessionSchema,
  StoredMessageSchema,
  validate,
} from "../../src/checkpoint/schemas";

describe("Checkpoint Schemas - Validation", () => {
  describe("validate helper", () => {
    it("should return valid data when validation succeeds", () => {
      const TestSchema = z.object({ id: z.string(), name: z.string() });
      const data = { id: "test-1", name: "Test" };
      const result = validate(TestSchema, data);
      expect(result).toEqual({ id: "test-1", name: "Test" });
    });

    it("should return null when validation fails", () => {
      const TestSchema = z.object({ id: z.string() });
      const data = { id: 123 };
      const result = validate(TestSchema, data);
      expect(result).toBeNull();
    });
  });

  describe("Session schema", () => {
    const validSession = {
      createdAt: 1_704_067_200_000,
      directory: "/test/dir",
      id: "session-1",
      updatedAt: 1_704_067_200_000,
    };

    it("should validate valid session data", () => {
      const result = validate(SessionSchema, validSession);
      expect(result).not.toBeNull();
      expect(result?.id).toBe("session-1");
      expect(result?.directory).toBe("/test/dir");
    });

    it("should reject missing required fields", () => {
      const result = validate(SessionSchema, {
        id: "session-1",
      });
      expect(result).toBeNull();
    });

    it("should reject invalid types", () => {
      const result = validate(SessionSchema, {
        ...validSession,
        createdAt: "not-a-number",
      });
      expect(result).toBeNull();
    });

    it("should accept optional fields", () => {
      const result = validate(SessionSchema, {
        ...validSession,
        metadata: { key: "value" },
        title: "Test Session",
        workspaceId: "workspace-1",
      });
      expect(result).not.toBeNull();
      expect(result?.title).toBe("Test Session");
      expect(result?.workspaceId).toBe("workspace-1");
    });
  });

  describe("Checkpoint schema", () => {
    const validCheckpoint = {
      createdAt: 1_704_067_200_000,
      id: "cp-1",
      namespace: "default",
      nodeResults: {},
      pendingNodes: [],
      sessionId: "session-1",
      source: "input",
      step: 0,
      version: 1,
    };

    it("should validate valid checkpoint data", () => {
      const result = validate(CheckpointSchema, validCheckpoint);
      expect(result).not.toBeNull();
      expect(result?.id).toBe("cp-1");
      expect(result?.source).toBe("input");
    });

    it("should validate all source types", () => {
      const sources = ["input", "loop", "interrupt", "fork"] as const;
      for (const source of sources) {
        const result = validate(CheckpointSchema, {
          ...validCheckpoint,
          source,
        });
        expect(result).not.toBeNull();
        expect(result?.source).toBe(source);
      }
    });

    it("should reject invalid source", () => {
      const result = validate(CheckpointSchema, {
        ...validCheckpoint,
        source: "invalid",
      });
      expect(result).toBeNull();
    });

    it("should accept optional fields", () => {
      const result = validate(CheckpointSchema, {
        ...validCheckpoint,
        cycleState: { backEdge: "edge-1", iteration: 1 },
        nodeId: "node-1",
        parentId: "parent-1",
      });
      expect(result).not.toBeNull();
      expect(result?.nodeId).toBe("node-1");
      expect(result?.cycleState?.iteration).toBe(1);
    });

    it("should validate nodeResults with complex data", () => {
      const result = validate(CheckpointSchema, {
        ...validCheckpoint,
        nodeResults: {
          node1: {
            completedAt: 1_704_067_201_000,
            output: { key: "value" },
            startedAt: 1_704_067_200_000,
            status: "completed",
          },
        },
      });
      expect(result).not.toBeNull();
      expect(result?.nodeResults.node1.status).toBe("completed");
    });
  });

  describe("StoredMessage schema", () => {
    const validMessage = {
      createdAt: 1_704_067_200_000,
      id: 1,
      role: "user",
      sessionId: "session-1",
    };

    it("should validate valid message data", () => {
      const result = validate(StoredMessageSchema, validMessage);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(1);
      expect(result?.role).toBe("user");
    });

    it("should validate all role types", () => {
      const roles = ["user", "assistant", "system", "tool"] as const;
      for (const role of roles) {
        const result = validate(StoredMessageSchema, {
          ...validMessage,
          role,
        });
        expect(result).not.toBeNull();
        expect(result?.role).toBe(role);
      }
    });

    it("should reject invalid role", () => {
      const result = validate(StoredMessageSchema, {
        ...validMessage,
        role: "invalid",
      });
      expect(result).toBeNull();
    });

    it("should accept optional content and tokens", () => {
      const result = validate(StoredMessageSchema, {
        ...validMessage,
        content: "Hello",
        tokensIn: 10,
        tokensOut: 20,
      });
      expect(result).not.toBeNull();
      expect(result?.content).toBe("Hello");
      expect(result?.tokensIn).toBe(10);
    });

    it("should validate with tool calls", () => {
      const result = validate(StoredMessageSchema, {
        ...validMessage,
        role: "assistant",
        toolCalls: [
          {
            function: {
              arguments: '{"key":"value"}',
              name: "test",
            },
            id: "call-1",
            type: "function",
          },
        ],
      });
      expect(result).not.toBeNull();
      expect(result?.toolCalls).toHaveLength(1);
    });
  });

  describe("Entity schema", () => {
    const validEntity = {
      attributes: {},
      createdAt: 1_704_067_200_000,
      id: "entity-1",
      name: "John Doe",
      relationships: [],
      sessionId: "session-1",
      type: "person",
      updatedAt: 1_704_067_200_000,
    };

    it("should validate valid entity data", () => {
      const result = validate(EntitySchema, validEntity);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("John Doe");
      expect(result?.type).toBe("person");
    });

    it("should validate entity with attributes", () => {
      const result = validate(EntitySchema, {
        ...validEntity,
        attributes: {
          active: true,
          age: 30,
          email: "john@example.com",
        },
      });
      expect(result).not.toBeNull();
      expect(result?.attributes.age).toBe(30);
    });

    it("should validate entity with relationships", () => {
      const result = validate(EntitySchema, {
        ...validEntity,
        relationships: [
          { targetId: "entity-2", type: "owns" },
          { targetId: "entity-3", type: "manages" },
        ],
      });
      expect(result).not.toBeNull();
      expect(result?.relationships).toHaveLength(2);
    });

    it("should accept optional embedding", () => {
      const result = validate(EntitySchema, {
        ...validEntity,
        embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
      });
      expect(result).not.toBeNull();
      expect(result?.embedding).toHaveLength(5);
    });

    it("should accept optional workspaceId", () => {
      const result = validate(EntitySchema, {
        ...validEntity,
        workspaceId: "workspace-1",
      });
      expect(result).not.toBeNull();
      expect(result?.workspaceId).toBe("workspace-1");
    });
  });

  describe("Fact schema", () => {
    const validFact = {
      confidence: 0.95,
      content: "John owns example.com",
      createdAt: 1_704_067_200_000,
      id: "fact-1",
    };

    it("should validate valid fact data", () => {
      const result = validate(FactSchema, validFact);
      expect(result).not.toBeNull();
      expect(result?.content).toBe("John owns example.com");
      expect(result?.confidence).toBe(0.95);
    });

    it("should reject confidence out of range", () => {
      const result1 = validate(FactSchema, {
        ...validFact,
        confidence: 1.5,
      });
      expect(result1).toBeNull();

      const result2 = validate(FactSchema, {
        ...validFact,
        confidence: -0.5,
      });
      expect(result2).toBeNull();
    });

    it("should accept optional fields", () => {
      const result = validate(FactSchema, {
        ...validFact,
        embedding: [0.1, 0.2, 0.3],
        sourceSessionId: "session-1",
        workspaceId: "workspace-1",
      });
      expect(result).not.toBeNull();
      expect(result?.sourceSessionId).toBe("session-1");
      expect(result?.workspaceId).toBe("workspace-1");
    });
  });

  describe("Corrupted data handling", () => {
    it("should reject null data", () => {
      const result = validate(SessionSchema, null);
      expect(result).toBeNull();
    });

    it("should reject undefined data", () => {
      const result = validate(SessionSchema, undefined);
      expect(result).toBeNull();
    });

    it("should reject array instead of object", () => {
      const result = validate(SessionSchema, []);
      expect(result).toBeNull();
    });

    it("should strip extra fields", () => {
      const result = validate(SessionSchema, {
        createdAt: 1,
        directory: "/test",
        extraField: "should be stripped",
        id: "session-1",
        updatedAt: 1,
      });
      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty("extraField");
    });

    it("should handle deeply nested corruption", () => {
      const result = validate(CheckpointSchema, {
        createdAt: 1_704_067_200_000,
        id: "cp-1",
        namespace: "default",
        nodeResults: {
          node1: {
            output: null,
            status: "invalid-status",
          },
        },
        pendingNodes: [],
        sessionId: "session-1",
        source: "input",
        step: 0,
        version: 1,
      });
      expect(result).toBeNull();
    });

    it("should reject wrong type for array fields", () => {
      const result = validate(EntitySchema, {
        attributes: {},
        createdAt: 1,
        id: "entity-1",
        name: "John",
        relationships: "not-an-array",
        sessionId: "session-1",
        type: "person",
        updatedAt: 1,
      });
      expect(result).toBeNull();
    });

    it("should reject wrong type for record fields", () => {
      const result = validate(CheckpointSchema, {
        createdAt: 1,
        id: "cp-1",
        namespace: "default",
        nodeResults: "not-a-record",
        pendingNodes: [],
        sessionId: "session-1",
        source: "input",
        step: 0,
        version: 1,
      });
      expect(result).toBeNull();
    });
  });

  describe("Real-world edge cases", () => {
    it("should handle empty strings", () => {
      const result = validate(EntitySchema, {
        attributes: {},
        createdAt: 1,
        id: "",
        name: "",
        relationships: [],
        sessionId: "session-1",
        type: "",
        updatedAt: 1,
      });
      expect(result).not.toBeNull();
    });

    it("should handle very long strings", () => {
      const longString = "a".repeat(10_000);
      const result = validate(FactSchema, {
        confidence: 0.5,
        content: longString,
        createdAt: 1,
        id: "fact-1",
      });
      expect(result).not.toBeNull();
      expect(result?.content).toBe(longString);
    });

    it("should handle large arrays", () => {
      const largeEmbedding = Array(1536)
        .fill(0)
        .map((_, i) => i / 1536);
      const result = validate(EntitySchema, {
        attributes: {},
        createdAt: 1,
        embedding: largeEmbedding,
        id: "entity-1",
        name: "Test",
        relationships: [],
        sessionId: "session-1",
        type: "test",
        updatedAt: 1,
      });
      expect(result).not.toBeNull();
      expect(result?.embedding).toHaveLength(1536);
    });

    it("should handle special characters in strings", () => {
      const specialContent = 'Test with <html> & "quotes" and \n newlines';
      const result = validate(FactSchema, {
        confidence: 0.5,
        content: specialContent,
        createdAt: 1,
        id: "fact-1",
      });
      expect(result).not.toBeNull();
      expect(result?.content).toBe(specialContent);
    });

    it("should handle numeric timestamps", () => {
      const now = Date.now();
      const result = validate(SessionSchema, {
        createdAt: now,
        directory: "/test",
        id: "session-1",
        updatedAt: now,
      });
      expect(result).not.toBeNull();
      expect(result?.createdAt).toBe(now);
    });
  });
});
