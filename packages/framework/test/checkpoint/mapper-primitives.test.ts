import { describe, expect, it } from "bun:test";
import {
  coerceNumeric,
  deserializeField,
  deserializeOptionalValue,
  deserializeValue,
  mapColumn,
  mapNumericColumn,
  mapOptionalColumn,
  mapRequiredStringColumn,
  parseEmbedding,
  requireCheckpointNodeResultsValue,
  requireCycleStateValue,
  requireRecordValue,
  requireRelationshipArrayValue,
  requireToolCallsValue,
  requireToolResultsValue,
  toNumber,
} from "../../src/checkpoint/ops/mapper-primitives";
import { JsonPlusSerializer } from "../../src/checkpoint/serializer";
import type { CheckpointNodeResult } from "../../src/checkpoint/types";

describe("Mapper Primitives - Characterization Tests", () => {
  const serializer = new JsonPlusSerializer();

  // ============================================================================
  // toNumber - Scalar coercion
  // ============================================================================
  describe("toNumber", () => {
    it("should return number as-is", () => {
      expect(toNumber(42)).toBe(42);
      expect(toNumber(0)).toBe(0);
      expect(toNumber(-5.5)).toBe(-5.5);
    });

    it("should convert string to number", () => {
      expect(toNumber("42")).toBe(42);
      expect(toNumber("3.14")).toBe(3.14);
      expect(toNumber("-10")).toBe(-10);
    });

    it("should return NaN for non-numeric string (current behavior)", () => {
      // CHARACTERIZATION: Non-numeric strings become NaN (whitespace becomes 0)
      expect(toNumber("not-a-number")).toBeNaN();
      expect(toNumber("")).toBe(0); // Empty string becomes 0
      expect(toNumber("   ")).toBe(0); // Whitespace also becomes 0 via Number()
    });

    it("should handle special numeric strings", () => {
      expect(toNumber("Infinity")).toBe(Infinity);
      expect(toNumber("-Infinity")).toBe(-Infinity);
      expect(toNumber("NaN")).toBeNaN();
    });
  });

  // ============================================================================
  // mapColumn - Column accessor with camelCase/snake_case support
  // ============================================================================
  describe("mapColumn", () => {
    it("should get value by camelCase key", () => {
      const row = { createdAt: 1000, userId: "123" };
      expect(mapColumn(row, "userId", "user_id")).toBe("123");
    });

    it("should get value by snake_case key when camelCase missing", () => {
      const row = { created_at: 2000, user_id: "456" };
      expect(mapColumn(row, "userId", "user_id")).toBe("456");
    });

    it("should prefer camelCase over snake_case when both present", () => {
      const row = { user_id: "snake", userId: "camel" };
      expect(mapColumn(row, "userId", "user_id")).toBe("camel");
    });

    it("should return undefined for missing column (current behavior)", () => {
      // CHARACTERIZATION: Missing columns return undefined
      const row = { otherField: "value" };
      expect(mapColumn(row, "missingField", "missing_field")).toBeUndefined();
    });

    it("should return undefined for null values (current behavior)", () => {
      // CHARACTERIZATION: Null values return undefined
      const row = { userId: null };
      expect(mapColumn(row, "userId", "user_id")).toBeUndefined();
    });

    it("should return undefined for undefined values", () => {
      const row = { userId: undefined };
      expect(mapColumn(row, "userId", "user_id")).toBeUndefined();
    });

    it("should apply parser when provided", () => {
      const row = { count: "42" };
      const parser = (v: unknown) => Number.parseInt(String(v), 10);
      expect(mapColumn(row, "count", "count", parser)).toBe(42);
    });

    it("should return undefined when parser returns non-primitive (current behavior)", () => {
      // CHARACTERIZATION: Objects without parser return undefined
      const row = { data: { nested: "value" } };
      expect(mapColumn(row, "data", "data")).toBeUndefined();
    });

    it("should accept primitives without parser", () => {
      const row = { bool: true, num: 42, str: "text" };
      expect(mapColumn(row, "str", "str")).toBe("text");
      expect(mapColumn(row, "num", "num")).toBe(42);
      expect(mapColumn(row, "bool", "bool")).toBe(true);
    });
  });

  // ============================================================================
  // mapNumericColumn - Numeric column with coercion
  // ============================================================================
  describe("mapNumericColumn", () => {
    it("should return number value as-is", () => {
      const row = { count: 42 };
      expect(mapNumericColumn(row, "count", "count")).toBe(42);
    });

    it("should coerce string to number", () => {
      const row = { count: "42" };
      expect(mapNumericColumn(row, "count", "count")).toBe(42);
    });

    it("should coerce numeric string from snake_case column", () => {
      const row = { created_at: "1000" };
      expect(mapNumericColumn(row, "createdAt", "created_at")).toBe(1000);
    });

    it("should throw for missing numeric column", () => {
      const row = { otherField: "value" };
      expect(() => mapNumericColumn(row, "missing", "missing")).toThrow(
        'Checkpoint row is missing required column "missing"'
      );
    });

    it("should throw for null numeric value", () => {
      const row = { count: null };
      expect(() => mapNumericColumn(row, "count", "count")).toThrow(
        'Checkpoint row is missing required column "count"'
      );
    });

    it("should throw for non-numeric string", () => {
      const row = { count: "not-a-number" };
      expect(() => mapNumericColumn(row, "count", "count")).toThrow(
        'Checkpoint row column "count" is not numeric'
      );
    });

    it("should handle 0 correctly", () => {
      const row = { count: 0 };
      expect(mapNumericColumn(row, "count", "count")).toBe(0);
    });

    it("should handle numeric string '0'", () => {
      const row = { count: "0" };
      expect(mapNumericColumn(row, "count", "count")).toBe(0);
    });

    it("should handle negative numbers", () => {
      const row = { count: -42 };
      expect(mapNumericColumn(row, "count", "count")).toBe(-42);
    });

    it("should handle float strings", () => {
      const row = { value: "3.14159" };
      expect(mapNumericColumn(row, "value", "value")).toBe(3.141_59);
    });
  });

  describe("coerceNumeric with { strict: true }", () => {
    it("should coerce numeric strings and numbers", () => {
      expect(coerceNumeric("42", "count", { strict: true })!).toBe(42);
      expect(coerceNumeric(7, "count", { strict: true })!).toBe(7);
    });

    it("should throw for nullish and non-numeric values", () => {
      expect(() => coerceNumeric(undefined, "count", { strict: true })!).toThrow(
        'required numeric field "count" is null or undefined'
      );
      expect(() => coerceNumeric({ nope: true }, "count", { strict: true })!).toThrow(
        'Row field "count" must be numeric-compatible'
      );
      expect(() => coerceNumeric("not-a-number", "count", { strict: true })!).toThrow(
        'Row field "count" is not numeric'
      );
    });
  });

  describe("mapRequiredStringColumn", () => {
    it("should return string values as-is", () => {
      expect(mapRequiredStringColumn({ name: "alice" }, "name", "name")).toBe("alice");
    });

    it("should stringify non-string values when column is present (current behavior)", () => {
      expect(mapRequiredStringColumn({ session_id: 99 }, "sessionId", "session_id")).toBe("99");
      expect(mapRequiredStringColumn({ enabled: true }, "enabled", "enabled")).toBe("true");
    });

    it("should throw when required column is missing", () => {
      expect(() => mapRequiredStringColumn({}, "sessionId", "session_id")).toThrow(
        'Checkpoint row is missing required column "sessionId/session_id"'
      );
    });
  });

  // ============================================================================
  // mapOptionalColumn - Optional field passthrough
  // ============================================================================
  describe("mapOptionalColumn", () => {
    it("should return value when present", () => {
      const row = { name: "John" };
      expect(mapOptionalColumn(row, "name", "name")).toBe("John");
    });

    it("should return undefined when missing", () => {
      const row = { other: "value" };
      expect(mapOptionalColumn(row, "name", "name")).toBeUndefined();
    });

    it("should return undefined for null", () => {
      const row = { name: null };
      expect(mapOptionalColumn(row, "name", "name")).toBeUndefined();
    });

    it("should return value from snake_case when camelCase missing", () => {
      const row = { workspace_id: "ws-123" };
      expect(mapOptionalColumn(row, "workspaceId", "workspace_id")).toBe("ws-123");
    });

    it("should prefer camelCase over snake_case", () => {
      const row = { workspace_id: "snake", workspaceId: "camel" };
      expect(mapOptionalColumn(row, "workspaceId", "workspace_id")).toBe("camel");
    });

    it("should return object values as-is (unlike mapColumn)", () => {
      // CHARACTERIZATION: mapOptionalColumn doesn't filter non-primitives
      const row = { metadata: { key: "value" } };
      // But mapColumn returns undefined for objects without parser
      expect(mapOptionalColumn(row, "metadata", "metadata")).toBeUndefined();
    });
  });

  // ============================================================================
  // deserializeValue - With fallback
  // ============================================================================
  describe("deserializeValue", () => {
    it("should return fallback for null", () => {
      expect(deserializeValue(serializer, null, "fallback")).toBe("fallback");
    });

    it("should return fallback for undefined", () => {
      expect(deserializeValue(serializer, undefined, "fallback")).toBe("fallback");
    });

    it("should deserialize string value", () => {
      const serialized = serializer.serialize({ key: "value" });
      expect(
        deserializeValue<{ key: string }>(serializer, serialized, { key: "fallback" })
      ).toEqual({
        key: "value",
      });
    });

    it("should return non-string value as-is (trusted cast)", () => {
      // CHARACTERIZATION: Non-string values pass through unchanged (trusted cast)
      const obj = { key: "value" };
      expect(
        deserializeValue<{ key: string }>(
          serializer,
          obj,
          { key: "fallback" },
          (value) => requireRecordValue(value, "value") as { key: string }
        )
      ).toBe(obj);
    });

    it("should return number as-is", () => {
      expect(deserializeValue(serializer, 42, 0)).toBe(42);
    });

    it("should return array as-is", () => {
      const arr = [1, 2, 3];
      expect(deserializeValue(serializer, arr, [])).toBe(arr);
    });

    it("should deserialize complex nested objects", () => {
      const data = { nested: { array: [1, 2, 3], date: new Date("2024-01-01") } };
      const serialized = serializer.serialize(data);
      const result = deserializeValue<{ nested: { array: Array<number>; date: Date } }>(
        serializer,
        serialized,
        {
          nested: { array: [], date: new Date(0) },
        }
      );
      expect(result.nested.array).toEqual([1, 2, 3]);
      expect(result.nested.date).toBeInstanceOf(Date);
    });

    it("should deserialize Buffer", () => {
      const buf = Buffer.from("hello");
      const serialized = serializer.serialize(buf);
      const result = deserializeValue<Buffer>(serializer, serialized, Buffer.alloc(0));
      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe("hello");
    });

    it("should throw for invalid serialized string", () => {
      expect(() => deserializeValue(serializer, "", { fallback: true })).toThrow();
    });
  });

  // ============================================================================
  // deserializeOptionalValue - Without fallback
  // ============================================================================
  describe("deserializeOptionalValue", () => {
    it("should return undefined for null", () => {
      expect(deserializeOptionalValue(serializer, null, requireRecordValue)).toBeUndefined();
    });

    it("should return undefined for undefined", () => {
      expect(deserializeOptionalValue(serializer, undefined, requireRecordValue)).toBeUndefined();
    });

    it("should deserialize string value", () => {
      const serialized = serializer.serialize({ key: "value" });
      expect(deserializeOptionalValue(serializer, serialized, requireRecordValue)).toEqual({
        key: "value",
      });
    });

    it("should return non-string value as-is", () => {
      const obj = { key: "value" };
      expect(deserializeOptionalValue(serializer, obj, requireRecordValue)).toBe(obj);
    });

    it("should throw CheckpointCorruptionError for empty string (current behavior)", () => {
      // CHARACTERIZATION: Empty string causes JSON parse error (throws)
      expect(() => deserializeOptionalValue(serializer, "", requireRecordValue)).toThrow();
    });
  });

  // ============================================================================
  // deserializeField - Field wrapper
  // ============================================================================
  describe("deserializeField", () => {
    it("should return undefined for null", () => {
      expect(deserializeField(null, serializer, requireRecordValue)).toBeUndefined();
    });

    it("should return undefined for undefined", () => {
      expect(deserializeField(undefined, serializer, requireRecordValue)).toBeUndefined();
    });

    it("should deserialize string value", () => {
      const serialized = serializer.serialize({ data: "value" });
      expect(deserializeField(serialized, serializer, requireRecordValue)).toEqual({
        data: "value",
      });
    });

    it("should return non-string value as-is", () => {
      const obj = { data: "value" };
      expect(deserializeField(obj, serializer, requireRecordValue)).toBe(obj);
    });

    it("should throw for invalid serialized string", () => {
      expect(() => deserializeField("", serializer, requireRecordValue)).toThrow();
    });
  });

  // ============================================================================
  // parseEmbedding - Invalid input handling (never throws)
  // ============================================================================
  describe("parseEmbedding", () => {
    it("should return undefined for null", () => {
      expect(parseEmbedding(null)).toBeUndefined();
    });

    it("should return undefined for undefined", () => {
      expect(parseEmbedding(undefined)).toBeUndefined();
    });

    it("should return array as-is", () => {
      const embedding = [0.1, 0.2, 0.3];
      expect(parseEmbedding(embedding)).toBe(embedding);
    });

    it("should parse valid JSON string", () => {
      const embedding = "[0.1, 0.2, 0.3]";
      expect(parseEmbedding(embedding)).toEqual([0.1, 0.2, 0.3]);
    });

    it("should parse Uint8Array with JSON", () => {
      const json = "[0.1, 0.2, 0.3]";
      const uint8 = new TextEncoder().encode(json);
      expect(parseEmbedding(uint8)).toEqual([0.1, 0.2, 0.3]);
    });

    it("should return undefined for invalid JSON string (current behavior)", () => {
      // CHARACTERIZATION: Invalid JSON returns undefined (logs error, never throws)
      expect(parseEmbedding("not-json")).toBeUndefined();
    });

    it("should return undefined for non-numeric array JSON (current behavior)", () => {
      // CHARACTERIZATION: Non-numeric arrays return undefined (logs error, never throws)
      expect(parseEmbedding('["a", "b"]')).toBeUndefined();
    });

    it("should return undefined for object JSON (current behavior)", () => {
      // CHARACTERIZATION: Objects return undefined (logs error, never throws)
      expect(parseEmbedding('{"key": "value"}')).toBeUndefined();
    });

    it("should return undefined for invalid Uint8Array (current behavior)", () => {
      // CHARACTERIZATION: Invalid Uint8Array returns undefined (logs error, never throws)
      const invalid = new Uint8Array([255, 255, 255]); // Invalid UTF-8 sequence
      expect(parseEmbedding(invalid)).toBeUndefined();
    });

    it("should return undefined for empty string", () => {
      expect(parseEmbedding("")).toBeUndefined();
    });

    it("should return undefined for empty array", () => {
      expect(parseEmbedding([])).toEqual([]);
    });

    it("should return undefined for empty Uint8Array", () => {
      expect(parseEmbedding(new Uint8Array())).toBeUndefined();
    });

    it("should handle large embeddings", () => {
      const large = Array(1536)
        .fill(0)
        .map((_, i) => i / 1536);
      const serialized = JSON.stringify(large);
      expect(parseEmbedding(serialized)).toEqual(large);
    });

    it("should handle negative numbers", () => {
      expect(parseEmbedding("[-0.5, -0.1, 0.0]")).toEqual([-0.5, -0.1, 0]);
    });

    it("should handle scientific notation", () => {
      expect(parseEmbedding("[1e-10, 2.5e5]")).toEqual([1e-10, 250_000]);
    });
  });

  describe("validated deserializer seams", () => {
    it("should validate checkpoint nodeResults rows", () => {
      const nodeResults: Record<string, CheckpointNodeResult> = {
        plan: { output: { ok: true }, startedAt: 1, status: "completed" },
      };

      const validatedNodeResults = requireCheckpointNodeResultsValue(nodeResults, "nodeResults");

      expect(validatedNodeResults.plan?.status).toBe("completed");
      expect(() =>
        requireCheckpointNodeResultsValue(
          { plan: { output: true, status: "bogus" } },
          "nodeResults"
        )
      ).toThrow('Checkpoint field "nodeResults" must be a nodeResults record (got object)');
    });

    it("should validate cycleState rows and normalize iteration", () => {
      expect(requireCycleStateValue({ backEdge: "retry", iteration: "2" }, "cycleState")).toEqual({
        backEdge: "retry",
        iteration: 2,
      });
      expect(() =>
        requireCycleStateValue({ backEdge: "retry", iteration: "NaN" }, "cycleState")
      ).toThrow('Checkpoint field "cycleState" must be a cycleState object (got object)');
    });

    it("should validate relationship arrays", () => {
      const relationships = [{ targetId: "entity-2", type: "owns" }];

      expect(requireRelationshipArrayValue(relationships, "relationships")).toBe(relationships);
      expect(() => requireRelationshipArrayValue([{ targetId: 5 }], "relationships")).toThrow(
        'Checkpoint field "relationships" must be an array of relationship objects (got array)'
      );
    });

    it("should validate tool call and result arrays", () => {
      const toolCalls = [{ input: { q: 1 }, name: "search", toolUseId: "tc-1" }];
      const toolResults = [{ content: "ok", status: "success", toolUseId: "tc-1" }];

      expect(requireToolCallsValue(toolCalls, "toolCalls")).toBe(toolCalls);
      expect(requireToolResultsValue(toolResults, "toolResults")).toBe(toolResults);
      expect(() =>
        requireToolCallsValue([{ input: null, name: "search", toolUseId: "tc-1" }], "toolCalls")
      ).toThrow('Checkpoint field "toolCalls" must be an array of tool call objects (got array)');
      expect(() =>
        requireToolResultsValue([{ content: 1, toolUseId: "tc-1" }], "toolResults")
      ).toThrow(
        'Checkpoint field "toolResults" must be an array of tool result objects (got array)'
      );
    });
  });

  // ============================================================================
  // Integration - Real-world row mapping scenarios
  // ============================================================================
  describe("Integration - Real-world scenarios", () => {
    it("should handle complete entity row mapping", () => {
      const row = {
        attributes: '{"age": 30}',
        created_at: "1000",
        embedding: "[0.1, 0.2, 0.3]",
        id: "entity-1",
        name: "John",
        relationships: "[]",
        session_id: "session-1",
        type: "person",
        updated_at: "2000",
        workspace_id: "ws-1",
      };

      // Simulate entity mapping
      const id = mapColumn(row, "id", "id") as string;
      const name = mapColumn(row, "name", "name") as string;
      const type = mapColumn(row, "type", "type") as string;
      const createdAt = mapNumericColumn(row, "createdAt", "created_at");
      const updatedAt = mapNumericColumn(row, "updatedAt", "updated_at");
      const workspaceId = mapOptionalColumn(row, "workspaceId", "workspace_id");
      const attributes = deserializeField(row.attributes, serializer, requireRecordValue);
      const embedding = parseEmbedding(row.embedding);

      expect(id).toBe("entity-1");
      expect(name).toBe("John");
      expect(type).toBe("person");
      expect(createdAt).toBe(1000);
      expect(updatedAt).toBe(2000);
      expect(workspaceId).toBe("ws-1");
      expect(attributes).toEqual({ age: 30 });
      expect(embedding).toEqual([0.1, 0.2, 0.3]);
    });

    it("should handle row with missing optional fields", () => {
      const row = {
        // Missing workspaceId and embedding
        created_at: "1000",
        id: "entity-1",
        name: "John",
        session_id: "session-1",
        type: "person",
        updated_at: "2000",
      };

      const workspaceId = mapOptionalColumn(row, "workspaceId", "workspace_id");
      const embedding = parseEmbedding(undefined);

      expect(workspaceId).toBeUndefined();
      expect(embedding).toBeUndefined();
    });

    it("should throw for row with invalid numeric fields", () => {
      const row = {
        created_at: "invalid-timestamp",
        id: "entity-1",
        name: "John",
        session_id: "session-1",
        type: "person",
        updated_at: null,
      };

      expect(() => mapNumericColumn(row, "createdAt", "created_at")).toThrow(
        'Checkpoint row column "createdAt/created_at" is not numeric'
      );
      expect(() => mapNumericColumn(row, "updatedAt", "updated_at")).toThrow(
        'Checkpoint row is missing required column "updatedAt/updated_at"'
      );
    });

    it("should handle mixed camelCase and snake_case row", () => {
      const row = {
        createdAt: "1000", // camelCase
        session_id: "session-1", // snake_case
        updated_at: "2000", // snake_case
        workspaceId: "ws-1", // camelCase
      };

      // Should prefer camelCase when present
      expect(mapNumericColumn(row, "createdAt", "created_at")).toBe(1000);
      expect(mapOptionalColumn(row, "sessionId", "session_id")).toBe("session-1");
      expect(mapNumericColumn(row, "updatedAt", "updated_at")).toBe(2000);
      expect(mapOptionalColumn(row, "workspaceId", "workspace_id")).toBe("ws-1");
    });
  });
});
