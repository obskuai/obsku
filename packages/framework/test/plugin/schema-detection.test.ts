// =============================================================================
// Tests for stricter isZodSchema detection
// Verifies: Zod schemas pass, impostors (objects with parse/safeParse but no _def) fail
// =============================================================================

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { isZodSchema } from "../../src/plugin/schema-conversion";

// ---------------------------------------------------------------------------
// Valid: real Zod schemas that MUST be detected
// ---------------------------------------------------------------------------

describe("isZodSchema — valid Zod schemas", () => {
  test("z.string() is detected", () => {
    expect(isZodSchema(z.string())).toBe(true);
  });

  test("z.number() is detected", () => {
    expect(isZodSchema(z.number())).toBe(true);
  });

  test("z.boolean() is detected", () => {
    expect(isZodSchema(z.boolean())).toBe(true);
  });

  test("z.object({}) is detected", () => {
    expect(isZodSchema(z.object({}))).toBe(true);
  });

  test("z.object with fields is detected", () => {
    expect(isZodSchema(z.object({ count: z.number(), name: z.string() }))).toBe(true);
  });

  test("z.array(z.string()) is detected", () => {
    expect(isZodSchema(z.array(z.string()))).toBe(true);
  });

  test("z.record(z.string(), z.unknown()) is detected", () => {
    expect(isZodSchema(z.record(z.string(), z.unknown()))).toBe(true);
  });

  test("z.union([...]) is detected", () => {
    expect(isZodSchema(z.union([z.string(), z.number()]))).toBe(true);
  });

  test("z.optional(z.string()) is detected", () => {
    expect(isZodSchema(z.string().optional())).toBe(true);
  });

  test("z.string().describe(...) is detected", () => {
    expect(isZodSchema(z.string().describe("A string field"))).toBe(true);
  });

  test("z.string().default('x') is detected", () => {
    expect(isZodSchema(z.string().default("x"))).toBe(true);
  });

  test("nested z.object is detected", () => {
    expect(
      isZodSchema(
        z.object({
          config: z.object({ host: z.string(), port: z.number() }),
        })
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invalid: impostors that old duck-typing would accept but strict detection rejects
// ---------------------------------------------------------------------------

describe("isZodSchema — invalid (impostors rejected by strict detection)", () => {
  test("plain object with parse+safeParse but no _def is rejected", () => {
    const impostor = {
      parse: (v: unknown) => v,
      safeParse: (v: unknown) => ({ data: v, success: true }),
    };
    expect(isZodSchema(impostor)).toBe(false);
  });

  test("object with only parse (no safeParse, no _def) is rejected", () => {
    const partial = { parse: (v: unknown) => v };
    expect(isZodSchema(partial)).toBe(false);
  });

  test("object with parse+safeParse+random_field but no _def is rejected", () => {
    const almostZod = {
      _type: "string",
      parse: (v: unknown) => v,
      safeParse: (v: unknown) => ({ data: v, success: true }),
    };
    expect(isZodSchema(almostZod)).toBe(false);
  });

  test("null is rejected", () => {
    expect(isZodSchema(null)).toBe(false);
  });

  test("undefined is rejected", () => {
    expect(isZodSchema(undefined)).toBe(false);
  });

  test("plain string is rejected", () => {
    expect(isZodSchema("string")).toBe(false);
  });

  test("number is rejected", () => {
    expect(isZodSchema(42)).toBe(false);
  });

  test("array is rejected", () => {
    expect(isZodSchema([1, 2, 3])).toBe(false);
  });

  test("empty object is rejected", () => {
    expect(isZodSchema({})).toBe(false);
  });

  test("ParamDef-style Record is rejected", () => {
    const paramRecord = {
      count: { type: "number" },
      name: { required: true, type: "string" },
    };
    expect(isZodSchema(paramRecord)).toBe(false);
  });

  test("class instance with parse+safeParse but no _def is rejected", () => {
    class FakeValidator {
      parse(v: unknown) {
        return v;
      }
      safeParse(v: unknown) {
        return { data: v, success: true };
      }
    }
    expect(isZodSchema(new FakeValidator())).toBe(false);
  });

  test("function is rejected", () => {
    expect(isZodSchema(() => {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Boundary: _def alone is insufficient (need parse+safeParse too)
// ---------------------------------------------------------------------------

describe("isZodSchema — boundary: _def alone is not enough", () => {
  test("object with _def but no parse/safeParse is rejected", () => {
    const defOnly = { _def: { typeName: "ZodString" } };
    expect(isZodSchema(defOnly)).toBe(false);
  });

  test("object with _def+parse but no safeParse is rejected", () => {
    const partial = { _def: { typeName: "ZodString" }, parse: (v: unknown) => v };
    expect(isZodSchema(partial)).toBe(false);
  });
});
