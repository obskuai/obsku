import { describe, expect, test } from "bun:test";
import { CheckpointCorruptionError } from "../../src/checkpoint/errors";
import { JsonPlusSerializer } from "../../src/checkpoint/serializer";

function getCorruptionError(
  serializer: JsonPlusSerializer,
  data: string
): CheckpointCorruptionError {
  try {
    serializer.deserialize(data);
  } catch (error) {
    return error as CheckpointCorruptionError;
  }

  throw new Error("Expected serializer.deserialize to throw");
}

describe("JsonPlusSerializer", () => {
  const serializer = new JsonPlusSerializer();

  test("serialize/deserialize primitives", () => {
    const data = {
      boolean: true,
      null: null,
      number: 42,
      string: "hello",
    };
    const serialized = serializer.serialize(data);
    const deserialized = serializer.deserialize(serialized);
    expect(deserialized).toEqual(data);
  });

  test("serialize/deserialize Date", () => {
    const date = new Date("2024-01-15T10:30:00.000Z");
    const data = { createdAt: date };
    const serialized = serializer.serialize(data);
    const deserialized = serializer.deserialize(serialized) as { createdAt: Date };
    expect(deserialized.createdAt).toBeInstanceOf(Date);
    expect(deserialized.createdAt.toISOString()).toBe(date.toISOString());
  });

  test("serialize/deserialize Map with nested objects", () => {
    const map = new Map([
      ["key1", { name: "value1" }],
      ["key2", { count: 42, name: "value2" }],
    ]);
    const data = { metadata: map };
    const serialized = serializer.serialize(data);
    const deserialized = serializer.deserialize(serialized) as { metadata: Map<string, unknown> };
    expect(deserialized.metadata).toBeInstanceOf(Map);
    expect(deserialized.metadata.get("key1")).toEqual({ name: "value1" });
    expect(deserialized.metadata.get("key2")).toEqual({ count: 42, name: "value2" });
  });

  test("serialize/deserialize Set", () => {
    const set = new Set(["a", "b", "c"]);
    const data = { tags: set };
    const serialized = serializer.serialize(data);
    const deserialized = serializer.deserialize(serialized) as { tags: Set<string> };
    expect(deserialized.tags).toBeInstanceOf(Set);
    expect([...deserialized.tags]).toEqual(["a", "b", "c"]);
  });

  test("serialize/deserialize Buffer", () => {
    const buffer = Buffer.from("hello world", "utf8");
    const data = { content: buffer };
    const serialized = serializer.serialize(data);
    const deserialized = serializer.deserialize(serialized) as { content: Buffer };
    expect(Buffer.isBuffer(deserialized.content)).toBe(true);
    expect(deserialized.content.toString("utf8")).toBe("hello world");
  });

  test("round-trip complex nested structures", () => {
    const complex = {
      content: Buffer.from("binary data"),
      createdAt: new Date("2024-01-15T10:30:00.000Z"),
      id: "test-123",
      metadata: new Map<string, unknown>([
        ["user", { age: 30, name: "Alice" }],
        ["tags", new Set(["admin", "active"])],
      ]),
      nested: {
        items: [
          { id: 1, timestamp: new Date("2024-01-14T00:00:00.000Z") },
          { id: 2, timestamp: new Date("2024-01-13T00:00:00.000Z") },
        ],
        lookup: new Map([["key", Buffer.from("value")]]),
      },
    };

    const serialized = serializer.serialize(complex);
    const deserialized = serializer.deserialize(serialized) as typeof complex;

    expect(deserialized.id).toBe("test-123");
    expect(deserialized.createdAt).toBeInstanceOf(Date);
    expect(deserialized.createdAt.toISOString()).toBe("2024-01-15T10:30:00.000Z");
    expect(deserialized.metadata).toBeInstanceOf(Map);
    expect(deserialized.content.toString()).toBe("binary data");
    expect(deserialized.nested.items[0].timestamp).toBeInstanceOf(Date);
    expect(deserialized.nested.lookup).toBeInstanceOf(Map);
    expect(Buffer.isBuffer(deserialized.nested.lookup.get("key"))).toBe(true);
  });

  describe("deserialize error handling", () => {
    test("should throw CheckpointCorruptionError for invalid JSON", () => {
      const invalidData = "not valid json";
      expect(() => serializer.deserialize(invalidData)).toThrow(CheckpointCorruptionError);
    });

    test("should throw CheckpointCorruptionError with data preview", () => {
      const invalidData = "not valid json";
      expect(() => serializer.deserialize(invalidData)).toThrow(
        "Checkpoint data is corrupted or invalid"
      );
    });

    test("should truncate data preview to 100 chars", () => {
      const longInvalidData = "x".repeat(150);
      let thrownError: unknown;
      try {
        serializer.deserialize(longInvalidData);
      } catch (error) {
        thrownError = error;
      }
      expect(thrownError).toBeInstanceOf(CheckpointCorruptionError);
      expect((thrownError as CheckpointCorruptionError).message).toContain("x".repeat(100));
      expect((thrownError as CheckpointCorruptionError).message).toContain("...");
    });

    test("should include cause in CheckpointCorruptionError", () => {
      const invalidData = "not valid json";
      let thrownError: unknown;
      try {
        serializer.deserialize(invalidData);
      } catch (error) {
        thrownError = error;
      }
      expect(thrownError).toBeInstanceOf(CheckpointCorruptionError);
      expect((thrownError as CheckpointCorruptionError).cause).toBeInstanceOf(Error);
    });

    test("should throw for invalid root tagged type", () => {
      const invalidData = JSON.stringify({ __type: 123, value: "2024-01-15T10:30:00.000Z" });

      const error = getCorruptionError(serializer, invalidData);

      expect(error).toBeInstanceOf(CheckpointCorruptionError);
      expect(error.cause).toBeInstanceOf(TypeError);
      expect((error.cause as Error).message).toContain("__type must be a string");
    });

    test("should throw for corrupt tagged map value", () => {
      const invalidData = JSON.stringify({
        metadata: {
          __type: "Map",
          value: [["ok", 1], ["broken"]],
        },
      });

      const error = getCorruptionError(serializer, invalidData);

      expect(error).toBeInstanceOf(CheckpointCorruptionError);
      expect(error.cause).toBeInstanceOf(TypeError);
      expect((error.cause as Error).message).toContain("Invalid Map checkpoint entry");
    });

    test("should throw for missing tagged value field", () => {
      const invalidData = JSON.stringify({ createdAt: { __type: "Date" } });

      const error = getCorruptionError(serializer, invalidData);

      expect(error).toBeInstanceOf(CheckpointCorruptionError);
      expect(error.cause).toBeInstanceOf(TypeError);
      expect((error.cause as Error).message).toContain("missing value field");
    });

    test("should throw for corrupt tagged date value", () => {
      const invalidData = JSON.stringify({ createdAt: { __type: "Date", value: "NOT_A_DATE" } });

      const error = getCorruptionError(serializer, invalidData);

      expect(error).toBeInstanceOf(CheckpointCorruptionError);
      expect(error.cause).toBeInstanceOf(TypeError);
      expect((error.cause as Error).message).toContain("not a valid date");
    });

    test("should preserve unknown tagged objects for compatibility", () => {
      const serialized = JSON.stringify({
        toolResult: {
          __type: "CustomToolEnvelope",
          nested: { __type: "Date", value: "2024-01-15T10:30:00.000Z" },
          value: { status: "ok" },
        },
      });

      const deserialized = serializer.deserialize(serialized) as {
        toolResult: { __type: string; nested: Date; value: { status: string } };
      };

      expect(deserialized.toolResult.__type).toBe("CustomToolEnvelope");
      expect(deserialized.toolResult.nested).toBeInstanceOf(Date);
      expect(deserialized.toolResult.value).toEqual({ status: "ok" });
    });
  });
});
