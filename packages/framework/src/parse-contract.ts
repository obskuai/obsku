import type { ZodType } from "zod";
import { getErrorMessage } from "./utils";

export type ParseSuccess<T> = { ok: true; value: T };
export type ParseJsonFailure = { error: string; ok: false; raw: string };
export type ValidationFailure = { error: string; ok: false; value: unknown };

export type ParseResult<T> = ParseSuccess<T> | ParseJsonFailure | ValidationFailure;

function formatValidationError(error: string, value: unknown): ValidationFailure {
  return { error, ok: false, value };
}

export function parseJson(raw: string): ParseSuccess<unknown> | ParseJsonFailure {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error: unknown) {
    return { error: getErrorMessage(error), ok: false, raw };
  }
}

export function validateParsed<T>(
  value: unknown,
  schema: ZodType<T>
): ParseSuccess<T> | ValidationFailure {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data };
  }

  const error = result.error.issues
    .map((issue) => {
      const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
      return `${path}: ${issue.message}`;
    })
    .join("; ");

  return formatValidationError(error, value);
}

export function parseAndValidate<T>(raw: string, schema: ZodType<T>): ParseResult<T> {
  const parsed = parseJson(raw);
  if (!parsed.ok) {
    return parsed;
  }

  return validateParsed(parsed.value, schema);
}
