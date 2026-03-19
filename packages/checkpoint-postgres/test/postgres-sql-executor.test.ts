import { describe, expect, it } from "bun:test";
import { translateSqlPlaceholders } from "../src/postgres-sql-executor";

describe("translateSqlPlaceholders", () => {
  it("replaces sqlite placeholders with postgres params", () => {
    const input = "SELECT * FROM t WHERE a = ? AND b = ?";
    expect(translateSqlPlaceholders(input)).toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
  });

  it("ignores placeholders inside string literals", () => {
    const input = "SELECT * FROM t WHERE note = '?' AND a = ?";
    expect(translateSqlPlaceholders(input)).toBe("SELECT * FROM t WHERE note = '?' AND a = $1");
  });

  it("handles escaped single quotes inside string literals", () => {
    const input = "SELECT * FROM t WHERE note = 'it''s ?' AND a = ?";
    expect(translateSqlPlaceholders(input)).toBe(
      "SELECT * FROM t WHERE note = 'it''s ?' AND a = $1"
    );
  });
});
