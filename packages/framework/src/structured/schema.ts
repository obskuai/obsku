import type { ZodSchema } from "zod";
import z from "zod";
import type { JsonSchema } from "../types/json-schema";

export function zodToJsonSchema(schema: ZodSchema): JsonSchema {
  return z.toJSONSchema(schema, {
    target: "openApi3",
    unrepresentable: "any",
  }) as unknown as JsonSchema;
}
