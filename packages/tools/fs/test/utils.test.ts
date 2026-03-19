import { describe, expect, test } from "bun:test";
import { handleFsError } from "../src/utils";

describe("handleFsError", () => {
  test("returns error ToolOutput for ENOENT", () => {
    const error = Object.assign(new Error("ENOENT: no such file or directory"), {
      code: "ENOENT",
    });
    const result = handleFsError(error, "/some/path");

    expect(result.isError).toBe(true);
    expect(result.content).toBe("File/Path not found: /some/path");
  });

  test("returns error ToolOutput for EACCES", () => {
    const error = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    const result = handleFsError(error, "/some/path");

    expect(result.isError).toBe(true);
    expect(result.content).toBe("Permission denied: /some/path");
  });

  test("re-throws unknown errors", () => {
    const error = new Error("Some other error");

    expect(() => handleFsError(error, "/some/path")).toThrow("Some other error");
  });

  test("re-throws errors without code", () => {
    const error = Object.assign(new Error("Unknown fs error"), {
      code: "EUNKNOWN",
    });

    expect(() => handleFsError(error, "/some/path")).toThrow("Unknown fs error");
  });
});
