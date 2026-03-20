import { z } from "zod";
import type { JsonSchema } from "../types/json-schema";
import type { McpProvider, PluginDef, PluginRunOutput } from "../types";
import { isRecord } from "../utils/type-guards";

const JSON_TYPE_TO_ZOD: Record<string, () => z.ZodTypeAny> = {
  boolean: () => z.boolean(),
  integer: () => z.number().int(),
  number: () => z.number(),
  string: () => z.string(),
};

function isJsonSchema(value: unknown): value is JsonSchema {
  return value !== null && typeof value === "object";
}

function applySchemaDescription(field: z.ZodTypeAny, schema: JsonSchema): z.ZodTypeAny {
  return schema.description ? field.describe(schema.description) : field;
}

function getSchemaTypes(schema: JsonSchema): Array<string> {
  if (Array.isArray(schema.type)) {
    return schema.type;
  }

  return typeof schema.type === "string" ? [schema.type] : [];
}

function isNullableSchema(schema: JsonSchema): boolean {
  return (
    getSchemaTypes(schema).includes("null") ||
    (schema.anyOf ?? []).some((subSchema) => getSchemaTypes(subSchema).includes("null"))
  );
}

function buildEnumSchema(values: Array<unknown>): z.ZodTypeAny {
  if (values.length === 0) {
    return z.never();
  }

  if (values.every((value): value is string => typeof value === "string")) {
    return z.enum(values as [string, ...Array<string>]);
  }

  return z.custom<unknown>((input) => values.some((value) => Object.is(value, input)));
}

function buildObjectSchema(schema: JsonSchema): z.ZodTypeAny {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  if (schema.additionalProperties === false) {
    return z.strictObject(
      Object.fromEntries(
        Object.entries(props).map(([name, propSchema]) => {
          let field = jsonSchemaToZod(propSchema);
          if (!required.has(name)) {
            field = field.optional();
          }
          return [name, field];
        })
      )
    );
  }

  const baseShape = Object.fromEntries(
    Object.entries(props).map(([name, propSchema]) => {
      let field = jsonSchemaToZod(propSchema);
      if (!required.has(name)) {
        field = field.optional();
      }
      return [name, field];
    })
  );

  if (isJsonSchema(schema.additionalProperties)) {
    return z.object(baseShape).catchall(jsonSchemaToZod(schema.additionalProperties));
  }

  return z.looseObject(baseShape);
}

function buildArraySchema(schema: JsonSchema): z.ZodTypeAny {
  if (Array.isArray(schema.items)) {
    const itemSchemas = schema.items.map((itemSchema) => jsonSchemaToZod(itemSchema));
    if (itemSchemas.length === 0) {
      return z.array(z.unknown());
    }

    if (itemSchemas.length === 1) {
      return z.array(itemSchemas[0]!);
    }

    return z.array(z.union(itemSchemas as [z.ZodTypeAny, z.ZodTypeAny, ...Array<z.ZodTypeAny>]));
  }

  return z.array(schema.items ? jsonSchemaToZod(schema.items) : z.unknown());
}

function resolveBaseSchema(schema: JsonSchema): z.ZodTypeAny {
  if (schema.enum) {
    return buildEnumSchema(schema.enum);
  }

  const unionMembers = (schema.anyOf ?? [])
    .filter((subSchema) => !getSchemaTypes(subSchema).includes("null"))
    .map((subSchema) => jsonSchemaToZod(subSchema));
  if (unionMembers.length === 1) {
    return unionMembers[0]!;
  }
  if (unionMembers.length > 1) {
    return z.union(unionMembers as [z.ZodTypeAny, z.ZodTypeAny, ...Array<z.ZodTypeAny>]);
  }

  const types = getSchemaTypes(schema).filter((type) => type !== "null");
  if (types.includes("object")) {
    return buildObjectSchema(schema);
  }
  if (types.includes("array")) {
    return buildArraySchema(schema);
  }
  for (const type of types) {
    const factory = JSON_TYPE_TO_ZOD[type];
    if (factory) {
      return factory();
    }
  }

  if (schema.properties) {
    return buildObjectSchema(schema);
  }
  if (schema.items) {
    return buildArraySchema(schema);
  }

  return z.unknown();
}

function jsonSchemaToZod(schema: unknown): z.ZodTypeAny {
  if (!isJsonSchema(schema)) {
    return z.looseObject({});
  }

  let field = resolveBaseSchema(schema);
  if (isNullableSchema(schema)) {
    field = field.nullable();
  }

  return applySchemaDescription(field, schema);
}

function normalizePluginRunOutput(result: unknown): PluginRunOutput {
  if (
    typeof result === "string" ||
    typeof result === "number" ||
    typeof result === "boolean" ||
    result === null ||
    result === undefined ||
    Array.isArray(result)
  ) {
    return result;
  }

  if (isRecord(result)) {
    return { ...result };
  }

  return String(result);
}

export async function mcpToPlugins(provider: McpProvider): Promise<Array<PluginDef>> {
  const tools = await provider.listTools();
  return tools.map((tool) => ({
    description: tool.description,
    name: tool.name,
    params: jsonSchemaToZod(tool.inputSchema),
    run: async (input, _ctx) =>
      normalizePluginRunOutput(
        await provider.callTool(tool.name, input as Record<string, unknown>)
      ),
  }));
}
