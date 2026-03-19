import { describe, expect, it } from "bun:test";
import { isRecord } from "@obsku/framework";

describe("isRecord", () => {
  it("should return false for arrays", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2, 3])).toBe(false);
    expect(isRecord(["a", "b"])).toBe(false);
  });

  it("should return true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord({ nested: { value: true } })).toBe(true);
  });

  it("should return false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("should return false for primitives", () => {
    expect(isRecord("string")).toBe(false);
    expect(isRecord(123)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord(Symbol("test"))).toBe(false);
  });

  it("should return false for functions", () => {
    expect(isRecord(() => {})).toBe(false);
    expect(isRecord(function () {})).toBe(false);
  });

  it("should return true for other object types (Date, RegExp, etc.)", () => {
    // Note: isRecord only excludes arrays, not other object types
    // This is consistent with the framework's type-guards.ts implementation
    expect(isRecord(new Date())).toBe(true);
    expect(isRecord(/regex/)).toBe(true);
    expect(isRecord(new Map())).toBe(true);
    expect(isRecord(new Set())).toBe(true);
  });
});
