// =============================================================================
// @obsku/framework — Schema detection + Zod→ParamDef conversion
// =============================================================================

import { z } from "zod";
import { debugLog } from "../telemetry";
import type { ParamDef } from "../types";

// Strict Zod schema detection using the `_def` internal property.
// Prevents plain objects with parse/safeParse from being misclassified as Zod schemas.
// `_def` is a Zod-specific internal schema definition present on all ZodType instances;
// it cannot be confused with ordinary objects that merely happen to expose parse/safeParse.
export function isZodSchema(value: unknown): value is z.ZodType {
  return (
    value !== null &&
    typeof value === "object" &&
    "_def" in value &&
    "parse" in value &&
    typeof (value as { parse: unknown }).parse === "function" &&
    "safeParse" in value &&
    typeof (value as { safeParse: unknown }).safeParse === "function"
  );
}

type JsonSchemaType = "string" | "number" | "boolean" | "object" | "array";

function resolveJsonSchemaType(propSchema: Record<string, unknown>): JsonSchemaType {
  const JSON_TYPE_MAP: Record<string, JsonSchemaType> = {
    array: "array",
    boolean: "boolean",
    integer: "number",
    number: "number",
    object: "object",
    string: "string",
  };

  const type = propSchema["type"];

  if (Array.isArray(type)) {
    const nonNull = (type as Array<string>).filter((t) => t !== "null");
    const first = nonNull[0];
    return (first !== undefined && JSON_TYPE_MAP[first]) || "string";
  }

  if (typeof type === "string") {
    return JSON_TYPE_MAP[type] ?? "string";
  }

  const anyOf = propSchema["anyOf"];
  if (Array.isArray(anyOf)) {
    for (const sub of anyOf as Array<Record<string, unknown>>) {
      const subType = sub["type"];
      if (typeof subType === "string" && subType !== "null" && JSON_TYPE_MAP[subType]) {
        return JSON_TYPE_MAP[subType];
      }
    }
  }

  return "string";
}

export function convertZodToParamDef(zodSchema: z.ZodType): Record<string, ParamDef> {
  const result: Record<string, ParamDef> = {};

  let jsonSchema: Record<string, unknown>;
  try {
    jsonSchema = z.toJSONSchema(zodSchema) as Record<string, unknown>;
  } catch (error: unknown) {
    debugLog(`Failed to convert Zod schema: ${error}`);
    throw new Error(`Failed to convert Zod schema for plugin`);
  }

  if (jsonSchema["type"] !== "object" || !jsonSchema["properties"]) {
    return result;
  }

  const properties = jsonSchema["properties"] as Record<string, Record<string, unknown>>;
  const required = (jsonSchema["required"] as Array<string>) ?? [];

  for (const [key, propSchema] of Object.entries(properties)) {
    const paramDef: ParamDef = {
      type: resolveJsonSchemaType(propSchema),
    };

    const description = propSchema["description"];
    if (typeof description === "string") {
      paramDef.description = description;
    }

    if (propSchema["default"] !== undefined) {
      paramDef.default = propSchema["default"];
    }

    if (!required.includes(key)) {
      paramDef.required = false;
    }

    result[key] = paramDef;
  }

  return result;
}
