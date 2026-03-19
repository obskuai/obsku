import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { zodToJsonSchema } from "../../src/structured/schema";

describe("zodToJsonSchema", () => {
  test("converts string schema", () => {
    const schema = z.string();
    const result = zodToJsonSchema(schema);
    expect(result).toEqual({ type: "string" });
  });

  test("converts number schema", () => {
    const schema = z.number();
    const result = zodToJsonSchema(schema);
    expect(result).toEqual({ type: "number" });
  });

  test("converts boolean schema", () => {
    const schema = z.boolean();
    const result = zodToJsonSchema(schema);
    expect(result).toEqual({ type: "boolean" });
  });

  test("converts object schema", () => {
    const schema = z.object({
      age: z.number(),
      name: z.string(),
    });
    const result = zodToJsonSchema(schema);
    expect(result).toMatchObject({
      additionalProperties: false,
      properties: {
        age: { type: "number" },
        name: { type: "string" },
      },
      required: ["age", "name"],
      type: "object",
    });
  });

  test("converts array schema", () => {
    const schema = z.array(z.string());
    const result = zodToJsonSchema(schema);
    expect(result).toEqual({
      items: { type: "string" },
      type: "array",
    });
  });

  test("converts enum schema", () => {
    const schema = z.enum(["red", "green", "blue"]);
    const result = zodToJsonSchema(schema);
    expect(result).toEqual({
      enum: ["red", "green", "blue"],
      type: "string",
    });
  });

  test("converts optional fields", () => {
    const schema = z.object({
      optional: z.number().optional(),
      required: z.string(),
    });
    const result = zodToJsonSchema(schema);
    expect(result).toEqual({
      additionalProperties: false,
      properties: {
        optional: { type: "number" },
        required: { type: "string" },
      },
      required: ["required"],
      type: "object",
    });
  });
});
