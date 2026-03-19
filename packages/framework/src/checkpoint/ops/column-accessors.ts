import { isNullish, coerceNumeric } from "./value-validators";

type PrimitiveValue = boolean | number | string;

const formatColumnName = (camelKey: string, snakeKey: string): string =>
  camelKey === snakeKey ? camelKey : `${camelKey}/${snakeKey}`;

const getColumnValue = (
  row: Record<string, unknown>,
  camelKey: string,
  snakeKey: string
): unknown =>
  camelKey in row
    ? row[camelKey]
    : camelKey.toLowerCase() in row
      ? row[camelKey.toLowerCase()]
      : row[snakeKey];

const requireColumnValue = (
  row: Record<string, unknown>,
  camelKey: string,
  snakeKey: string
): unknown => {
  const value = getColumnValue(row, camelKey, snakeKey);
  if (isNullish(value)) {
    throw new Error(
      `Checkpoint row is missing required column "${formatColumnName(camelKey, snakeKey)}"`
    );
  }

  return value;
};

const parseNumericValue = (value: unknown, columnName: string): number =>
  coerceNumeric(value, columnName, { strict: true, fieldLabel: "Checkpoint row column" })!;

export function mapColumn<T extends PrimitiveValue>(
  row: Record<string, unknown>,
  camelKey: string,
  snakeKey: string
): T | undefined;
export function mapColumn<T>(
  row: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
  parser: (v: unknown) => T
): T | undefined;
export function mapColumn<T>(
  row: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
  parser?: (v: unknown) => T
): PrimitiveValue | T | undefined {
  const value = getColumnValue(row, camelKey, snakeKey);
  if (isNullish(value)) {
    return undefined;
  }
  if (parser) {
    return parser(value);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

export const mapNumericColumn = (
  row: Record<string, unknown>,
  camelKey: string,
  snakeKey: string
): number =>
  parseNumericValue(
    requireColumnValue(row, camelKey, snakeKey),
    formatColumnName(camelKey, snakeKey)
  );

export const mapRequiredStringColumn = (
  row: Record<string, unknown>,
  camelKey: string,
  snakeKey: string
): string => {
  const value = requireColumnValue(row, camelKey, snakeKey);
  return typeof value === "string" ? value : String(value);
};

export const mapOptionalColumn = <T extends PrimitiveValue>(
  row: Record<string, unknown>,
  camelKey: string,
  snakeKey: string
): T | undefined => mapColumn<T>(row, camelKey, snakeKey);

export const mapOptionalColumnWithParser = <T>(
  row: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
  parser: (v: unknown) => T
): T | undefined => {
  const value = getColumnValue(row, camelKey, snakeKey);
  if (isNullish(value)) {
    return undefined;
  }

  return parser(value);
};
