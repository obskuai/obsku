// =============================================================================
// @obsku/framework — Param validation, defaults, and ParamDef→Zod conversion
// =============================================================================

import { z } from "zod";
import type { ParamDef } from "../types";

export function validateParams(
  input: Record<string, unknown>,
  schema: Record<string, ParamDef>
): Array<string> {
  const errors: Array<string> = [];

  for (const [key, def] of Object.entries(schema)) {
    const value = input[key];

    // Check required
    if (def.required !== false && value === undefined && def.default === undefined) {
      errors.push(`Missing required param: "${key}"`);
      continue;
    }

    // Skip validation if not provided and has default / optional
    if (value === undefined) {
      continue;
    }

    // Type check
    const actualType = Array.isArray(value) ? "array" : typeof value;
    if (actualType !== def.type) {
      errors.push(`Param "${key}" expected type "${def.type}", got "${actualType}"`);
    }
  }

  return errors;
}

export function applyDefaults(
  input: Record<string, unknown>,
  schema: Record<string, ParamDef>
): Record<string, unknown> {
  const result = { ...input };
  for (const [key, def] of Object.entries(schema)) {
    if (result[key] === undefined && def.default !== undefined) {
      result[key] = def.default;
    }
  }
  return result;
}

/**
 * Convert a single ParamDef entry to a Zod schema.
 * Exported for reuse by agent-factory and other internal consumers.
 */
export function paramDefToZod(param: {
  description?: string;
  required?: boolean;
  type: string;
}): z.ZodType {
  let schema: z.ZodType;
  switch (param.type) {
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "array":
      schema = z.array(z.unknown());
      break;
    case "object":
      schema = z.record(z.string(), z.unknown());
      break;
    case "string":
    default:
      schema = z.string();
  }
  if (param.description) {
    schema = (schema as z.ZodTypeAny).describe(param.description);
  }
  if (param.required === false) {
    schema = (schema as z.ZodTypeAny).optional();
  }
  return schema;
}
