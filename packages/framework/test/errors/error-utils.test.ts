import { describe, expect, it } from "bun:test";
import { getErrorMessage, getErrorStack, toErrorRecord } from "../../src/error-utils";

describe("getErrorMessage", () => {
  it("extracts message from standard Error", () => {
    const error = new Error("Something went wrong");
    expect(getErrorMessage(error)).toBe("Something went wrong");
  });

  it("extracts message from TypeError", () => {
    const error = new TypeError("Invalid type provided");
    expect(getErrorMessage(error)).toBe("Invalid type provided");
  });

  it("extracts message from RangeError", () => {
    const error = new RangeError("Value out of range");
    expect(getErrorMessage(error)).toBe("Value out of range");
  });

  it("extracts message from custom Error subclass", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }
    const error = new CustomError("Custom error occurred");
    expect(getErrorMessage(error)).toBe("Custom error occurred");
  });

  it("returns string as-is when passed a string", () => {
    expect(getErrorMessage("Plain string error")).toBe("Plain string error");
  });

  it("returns empty string for empty string error", () => {
    expect(getErrorMessage("")).toBe("");
  });

  it("JSON.stringifies plain objects", () => {
    const obj = { code: 500, status: "error" };
    expect(getErrorMessage(obj)).toBe('{"code":500,"status":"error"}');
  });

  it("JSON.stringifies objects with message property (non-Error)", () => {
    const obj = { message: "Object message", code: 400 };
    expect(getErrorMessage(obj)).toBe('{"message":"Object message","code":400}');
  });

  it("handles null", () => {
    expect(getErrorMessage(null)).toBe("null");
  });

  it("handles undefined", () => {
    expect(getErrorMessage(undefined)).toBe(undefined);
  });

  it("handles numbers", () => {
    expect(getErrorMessage(42)).toBe("42");
    expect(getErrorMessage(0)).toBe("0");
    expect(getErrorMessage(-1)).toBe("-1");
  });

  it("handles booleans", () => {
    expect(getErrorMessage(true)).toBe("true");
    expect(getErrorMessage(false)).toBe("false");
  });

  it("handles arrays", () => {
    expect(getErrorMessage([1, 2, 3])).toBe("[1,2,3]");
    expect(getErrorMessage([])).toBe("[]");
  });

  it("handles objects with nested structures", () => {
    const obj = { user: { id: 1, name: "test" }, errors: ["a", "b"] };
    expect(getErrorMessage(obj)).toBe('{"user":{"id":1,"name":"test"},"errors":["a","b"]}');
  });

  it("falls back to String() for circular references", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj; // Create circular reference
    const result = getErrorMessage(obj);
    // Should fall back to String() which produces "[object Object]"
    expect(result).toBe("[object Object]");
  });

  it("handles Error with empty message", () => {
    const error = new Error();
    expect(getErrorMessage(error)).toBe("");
  });

  it("handles Symbol (returns undefined via JSON.stringify)", () => {
    const sym = Symbol("test");
    expect(getErrorMessage(sym)).toBe(undefined);
  });

  it("handles BigInt", () => {
    const big = BigInt(9007199254740991);
    expect(getErrorMessage(big)).toBe("9007199254740991");
  });

  it("handles functions", () => {
    const fn = () => "test";
    expect(getErrorMessage(fn)).toBe(undefined);
  });
});

describe("getErrorStack", () => {
  it("returns stack from Error instance", () => {
    const error = new Error("Test error");
    const stack = getErrorStack(error);
    expect(typeof stack).toBe("string");
    expect(stack).toContain("Error: Test error");
  });

  it("returns undefined for string error", () => {
    expect(getErrorStack("string error")).toBeUndefined();
  });

  it("returns undefined for plain object", () => {
    expect(getErrorStack({ message: "error" })).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(getErrorStack(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(getErrorStack(undefined)).toBeUndefined();
  });

  it("returns stack from TypeError", () => {
    const error = new TypeError("Type error");
    const stack = getErrorStack(error);
    expect(typeof stack).toBe("string");
    expect(stack).toContain("TypeError: Type error");
  });
});

describe("toErrorRecord", () => {
  it("returns object for plain object", () => {
    const obj = { code: 500, message: "error" };
    expect(toErrorRecord(obj)).toEqual(obj);
  });

  it("returns undefined for string", () => {
    expect(toErrorRecord("error")).toBeUndefined();
  });

  it("returns undefined for number", () => {
    expect(toErrorRecord(42)).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(toErrorRecord(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(toErrorRecord(undefined)).toBeUndefined();
  });

  it("returns object for Error instance", () => {
    const error = new Error("test");
    const record = toErrorRecord(error);
    expect(record).toBeDefined();
    expect(record?.["message"]).toBe("test");
  });

  it("returns object for arrays", () => {
    const arr = [1, 2, 3];
    const record = toErrorRecord(arr);
    expect(record).toBeDefined();
    expect(record?.["0"]).toBe(1);
    expect(record?.["1"]).toBe(2);
  });
});
