import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseAndValidate, parseJson, validateParsed } from "../src/parse-contract";

describe("parse-contract", () => {
  const schema = z.object({ count: z.number(), name: z.string() });

  test("parseJson returns parsed unknown on valid JSON", () => {
    expect(parseJson('{"count":1,"name":"ok"}')).toEqual({
      ok: true,
      value: { count: 1, name: "ok" },
    });
  });

  test("parseJson returns error context + raw on invalid JSON", () => {
    expect(parseJson('{"count":1,')).toEqual({
      error: expect.any(String),
      ok: false,
      raw: '{"count":1,',
    });
  });

  test("parseJson returns error context + raw on empty string", () => {
    expect(parseJson("")).toEqual({
      error: expect.any(String),
      ok: false,
      raw: "",
    });
  });

  test("validateParsed returns typed value for schema match", () => {
    expect(validateParsed({ count: 2, name: "valid" }, schema)).toEqual({
      ok: true,
      value: { count: 2, name: "valid" },
    });
  });

  test("validateParsed returns zod detail context for schema mismatch", () => {
    expect(validateParsed({ count: "bad", name: "valid" }, schema)).toEqual({
      error: expect.stringContaining("count"),
      ok: false,
      value: { count: "bad", name: "valid" },
    });
  });

  test("parseAndValidate returns typed value for valid json + schema", () => {
    expect(parseAndValidate('{"count":3,"name":"typed"}', schema)).toEqual({
      ok: true,
      value: { count: 3, name: "typed" },
    });
  });

  test("parseAndValidate returns parse failure with raw context", () => {
    expect(parseAndValidate('{"count":3', schema)).toEqual({
      error: expect.any(String),
      ok: false,
      raw: '{"count":3',
    });
  });

  test("parseAndValidate returns validation failure with parsed value context", () => {
    expect(parseAndValidate('{"count":"bad","name":"typed"}', schema)).toEqual({
      error: expect.stringContaining("count"),
      ok: false,
      value: { count: "bad", name: "typed" },
    });
  });
});
