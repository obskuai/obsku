/**
 * JSON Schema type definitions for structured output validation.
 */

export interface JsonSchema {
  additionalProperties?: boolean | JsonSchema;
  anyOf?: Array<JsonSchema>;
  description?: string;
  enum?: Array<unknown>;
  items?: JsonSchema | Array<JsonSchema>;
  properties?: Record<string, JsonSchema>;
  required?: Array<string>;
  type?: string | Array<string>;
  [key: string]: unknown;
}
