import { describe, expect, it } from "bun:test";
import {
  VectorDimensionError,
  EmbeddingDeserializationError,
  deserializeEmbedding,
  serializeEmbedding,
} from "../../src/checkpoint/similarity";

describe("VectorDimensionError", () => {
  it("should extend Error", () => {
    const error = new VectorDimensionError(768, 1024);
    expect(error).toBeInstanceOf(Error);
  });

  it("should be instanceof VectorDimensionError", () => {
    const error = new VectorDimensionError(768, 1024);
    expect(error).toBeInstanceOf(VectorDimensionError);
  });

  it("should have correct _tag", () => {
    const error = new VectorDimensionError(768, 1024);
    expect(error._tag).toBe("VectorDimensionError");
  });

  it("should have correct name", () => {
    const error = new VectorDimensionError(768, 1024);
    expect(error.name).toBe("VectorDimensionError");
  });

  it("should format message with both dimension values", () => {
    const error = new VectorDimensionError(768, 1024);
    expect(error.message).toBe("Vector dimensions must match: 768 vs 1024");
  });

  it("should work with different dimension values", () => {
    const error = new VectorDimensionError(512, 768);
    expect(error.message).toBe("Vector dimensions must match: 512 vs 768");
  });

  it("should contain 'Vector dimensions must match' substring for test compatibility", () => {
    const error = new VectorDimensionError(100, 200);
    expect(() => {
      throw error;
    }).toThrow("Vector dimensions must match");
  });

  it("should contain both dimension values in message", () => {
    const error = new VectorDimensionError(300, 400);
    expect(error.message).toContain("300");
    expect(error.message).toContain("400");
  });

  it("should expose dimensionA property", () => {
    const error = new VectorDimensionError(768, 1024);
    expect(error.dimensionA).toBe(768);
  });

  it("should expose dimensionB property", () => {
    const error = new VectorDimensionError(768, 1024);
    expect(error.dimensionB).toBe(1024);
  });
});

describe("EmbeddingDeserializationError", () => {
  it("should extend Error", () => {
    const error = new EmbeddingDeserializationError("test", new Error("original"));
    expect(error).toBeInstanceOf(Error);
  });

  it("should be instanceof EmbeddingDeserializationError", () => {
    const error = new EmbeddingDeserializationError("test", new Error("original"));
    expect(error).toBeInstanceOf(EmbeddingDeserializationError);
  });

  it("should have correct _tag", () => {
    const error = new EmbeddingDeserializationError("test", new Error("original"));
    expect(error._tag).toBe("EmbeddingDeserializationError");
  });

  it("should have correct name", () => {
    const error = new EmbeddingDeserializationError("test", new Error("original"));
    expect(error.name).toBe("EmbeddingDeserializationError");
  });

  it("should contain reason in message", () => {
    const error = new EmbeddingDeserializationError("invalid format", new Error("original"));
    expect(error.message).toContain("invalid format");
  });

  it("should expose originalError property", () => {
    const original = new Error("nested error");
    const error = new EmbeddingDeserializationError("test", original);
    expect(error.originalError).toBe(original);
  });
});

describe("deserializeEmbedding", () => {
  it("should return null for null input", () => {
    const result = deserializeEmbedding(null);
    expect(result).toBeNull();
  });

  it("should return null for empty Uint8Array", () => {
    const result = deserializeEmbedding(new Uint8Array(0));
    expect(result).toBeNull();
  });

  it("should deserialize valid JSON string to number array", () => {
    const embedding = [0.1, 0.2, 0.3];
    const serialized = serializeEmbedding(embedding);
    expect(serialized).not.toBeNull();
    const deserialized = deserializeEmbedding(serialized!);
    expect(deserialized).toEqual(embedding);
  });

  it("should deserialize valid Uint8Array to number array", () => {
    const embedding = [0.5, 0.6, 0.7];
    const serialized = serializeEmbedding(embedding);
    expect(serialized).not.toBeNull();
    const encoded = new TextEncoder().encode(serialized!);
    const deserialized = deserializeEmbedding(encoded);
    expect(deserialized).toEqual(embedding);
  });

  it("should deserialize valid Buffer to number array", () => {
    const embedding = [0.9, 0.8, 0.7];
    const serialized = serializeEmbedding(embedding);
    expect(serialized).not.toBeNull();
    const buffer = Buffer.from(serialized!);
    const deserialized = deserializeEmbedding(buffer);
    expect(deserialized).toEqual(embedding);
  });

  it("should throw EmbeddingDeserializationError on invalid JSON string", () => {
    const invalid = "not valid json {";
    expect(() => deserializeEmbedding(invalid)).toThrow(EmbeddingDeserializationError);
  });

  it("should throw EmbeddingDeserializationError on malformed numeric array", () => {
    const invalidEmbedding = JSON.stringify([1, "not a number", 3]);
    expect(() => deserializeEmbedding(invalidEmbedding)).toThrow(EmbeddingDeserializationError);
  });

  it("should throw EmbeddingDeserializationError on non-array JSON", () => {
    const nonArray = JSON.stringify({ x: 1, y: 2 });
    expect(() => deserializeEmbedding(nonArray)).toThrow(EmbeddingDeserializationError);
  });

  it("should return empty array for empty array JSON", () => {
    const emptyArray = JSON.stringify([]);
    const result = deserializeEmbedding(emptyArray);
    expect(result).toEqual([]);
  });

  it("error should contain 'Invalid JSON' for malformed JSON", () => {
    const invalid = "{ broken";
    let caughtError: EmbeddingDeserializationError | undefined;
    try {
      deserializeEmbedding(invalid);
    } catch (error) {
      if (error instanceof EmbeddingDeserializationError) {
        caughtError = error;
      }
    }
    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toContain("Invalid JSON");
  });

  it("error should contain 'Invalid numeric array' for type mismatch", () => {
    const malformed = JSON.stringify([1, 2, "three"]);
    let caughtError: EmbeddingDeserializationError | undefined;
    try {
      deserializeEmbedding(malformed);
    } catch (error) {
      if (error instanceof EmbeddingDeserializationError) {
        caughtError = error;
      }
    }
    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toContain("Invalid numeric array");
  });
});

describe("serializeEmbedding", () => {
  it("should return null for null input", () => {
    const result = serializeEmbedding(null);
    expect(result).toBeNull();
  });

  it("should serialize number array to JSON string", () => {
    const embedding = [0.1, 0.2, 0.3];
    const serialized = serializeEmbedding(embedding);
    expect(typeof serialized).toBe("string");
    expect(JSON.parse(serialized!)).toEqual(embedding);
  });

  it("should serialize empty array", () => {
    const embedding: Array<number> = [];
    const serialized = serializeEmbedding(embedding);
    expect(serialized).toBe("[]");
  });

  it("should round-trip through deserialize", () => {
    const original = [0.1, 0.2, 0.3];
    const serialized = serializeEmbedding(original);
    const deserialized = deserializeEmbedding(serialized!);
    expect(deserialized).toEqual(original);
  });
});
