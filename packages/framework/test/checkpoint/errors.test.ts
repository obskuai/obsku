import { describe, expect, it } from "bun:test";
import {
  CheckpointCorruptionError,
  CheckpointNotFoundError,
  EntityNotFoundError,
  SessionNotFoundError,
} from "../../src/checkpoint/errors";

describe("Checkpoint Error Classes", () => {
  describe("SessionNotFoundError", () => {
    it("should extend Error", () => {
      const error = new SessionNotFoundError("abc");
      expect(error).toBeInstanceOf(Error);
    });

    it("should be instanceof SessionNotFoundError", () => {
      const error = new SessionNotFoundError("abc");
      expect(error).toBeInstanceOf(SessionNotFoundError);
    });

    it("should have correct _tag", () => {
      const error = new SessionNotFoundError("abc");
      expect(error._tag).toBe("SessionNotFoundError");
    });

    it("should have correct name", () => {
      const error = new SessionNotFoundError("abc");
      expect(error.name).toBe("SessionNotFoundError");
    });

    it("should format message with session id", () => {
      const error = new SessionNotFoundError("abc");
      expect(error.message).toBe("Session not found: abc");
    });

    it("should contain 'Session not found' substring for test compatibility", () => {
      const error = new SessionNotFoundError("xyz-123");
      expect(() => {
        throw error;
      }).toThrow("Session not found");
    });
  });

  describe("CheckpointNotFoundError", () => {
    it("should extend Error", () => {
      const error = new CheckpointNotFoundError("cp-1");
      expect(error).toBeInstanceOf(Error);
    });

    it("should be instanceof CheckpointNotFoundError", () => {
      const error = new CheckpointNotFoundError("cp-1");
      expect(error).toBeInstanceOf(CheckpointNotFoundError);
    });

    it("should have correct _tag", () => {
      const error = new CheckpointNotFoundError("cp-1");
      expect(error._tag).toBe("CheckpointNotFoundError");
    });

    it("should have correct name", () => {
      const error = new CheckpointNotFoundError("cp-1");
      expect(error.name).toBe("CheckpointNotFoundError");
    });

    it("should format message with checkpoint id", () => {
      const error = new CheckpointNotFoundError("cp-1");
      expect(error.message).toBe("Checkpoint not found: cp-1");
    });

    it("should contain 'Checkpoint not found' substring for test compatibility", () => {
      const error = new CheckpointNotFoundError("cp-xyz");
      expect(() => {
        throw error;
      }).toThrow("Checkpoint not found");
    });
  });

  describe("EntityNotFoundError", () => {
    it("should extend Error", () => {
      const error = new EntityNotFoundError("ent-1");
      expect(error).toBeInstanceOf(Error);
    });

    it("should be instanceof EntityNotFoundError", () => {
      const error = new EntityNotFoundError("ent-1");
      expect(error).toBeInstanceOf(EntityNotFoundError);
    });

    it("should have correct _tag", () => {
      const error = new EntityNotFoundError("ent-1");
      expect(error._tag).toBe("EntityNotFoundError");
    });

    it("should have correct name", () => {
      const error = new EntityNotFoundError("ent-1");
      expect(error.name).toBe("EntityNotFoundError");
    });

    it("should format message with entity id", () => {
      const error = new EntityNotFoundError("ent-1");
      expect(error.message).toBe("Entity not found: ent-1");
    });

    it("should contain 'Entity not found' substring for test compatibility", () => {
      const error = new EntityNotFoundError("ent-xyz");
      expect(() => {
        throw error;
      }).toThrow("Entity not found");
    });
  });

  describe("CheckpointCorruptionError", () => {
    it("should extend Error", () => {
      const error = new CheckpointCorruptionError("corrupt-data");
      expect(error).toBeInstanceOf(Error);
    });

    it("should be instanceof CheckpointCorruptionError", () => {
      const error = new CheckpointCorruptionError("corrupt-data");
      expect(error).toBeInstanceOf(CheckpointCorruptionError);
    });

    it("should have correct _tag", () => {
      const error = new CheckpointCorruptionError("corrupt-data");
      expect(error._tag).toBe("CheckpointCorruptionError");
    });

    it("should have correct name", () => {
      const error = new CheckpointCorruptionError("corrupt-data");
      expect(error.name).toBe("CheckpointCorruptionError");
    });

    it("should format message with data preview", () => {
      const error = new CheckpointCorruptionError("invalid-json");
      expect(error.message).toBe("Checkpoint data is corrupted or invalid: invalid-json");
    });

    it("should truncate data preview to 100 chars", () => {
      const longData = "a".repeat(150);
      const error = new CheckpointCorruptionError(longData);
      expect(error.message).toBe(`Checkpoint data is corrupted or invalid: ${"a".repeat(100)}...`);
    });

    it("should include cause when provided", () => {
      const cause = new Error("Original parse error");
      const error = new CheckpointCorruptionError("data", cause);
      expect(error.cause).toBe(cause);
    });

    it("should not set cause when not an Error", () => {
      const error = new CheckpointCorruptionError("data", "not an error");
      expect(error.cause).toBeUndefined();
    });

    it("should contain 'corrupted' substring for test compatibility", () => {
      const error = new CheckpointCorruptionError("bad-data");
      expect(() => {
        throw error;
      }).toThrow("corrupted");
    });
  });
});
