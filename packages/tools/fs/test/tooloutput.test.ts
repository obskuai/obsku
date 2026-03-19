import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { createFsTools } from "../src/index";

const TEST_DIR = join(import.meta.dir, "__test_sandbox__");

// Typed result interface matching PluginExecutionResult
interface ToolResult {
  isError?: boolean;
  result: string;
}

// Type guard for safe narrowing
function isToolResult(value: unknown): value is ToolResult {
  return value !== null && typeof value === "object" && "result" in value;
}

function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromiseExit(effect);
}

function setup() {
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  rmSync(TEST_DIR, { force: true, recursive: true });
}

describe("ToolOutput Error Handling - readFile", () => {
  const tools = createFsTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  test("non-existent file returns result with isError: true", async () => {
    const exit = await run(tools.readFile.execute({ path: "nonexistent.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(result).toHaveProperty("isError", true);
    expect(result).toHaveProperty("result");
    expect(isToolResult(result)).toBe(true);
    if (isToolResult(result)) {
      expect(typeof result.result).toBe("string");
      expect(result.result).toContain("not found");
    }
  });

  test("success case returns result without isError", async () => {
    const exit = await run(tools.writeFile.execute({ content: "hello", path: "test.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(isToolResult(result) && result.isError).toBe(false);
    expect(result).toHaveProperty("result");
    if (isToolResult(result)) {
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
    }
  });
});

describe("ToolOutput Error Handling - writeFile", () => {
  const tools = createFsTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  test("permission error returns result with isError: true", async () => {
    const roDir = join(TEST_DIR, "readonly");
    mkdirSync(roDir, { recursive: true });
    chmodSync(roDir, 0o444);

    const exit = await run(tools.writeFile.execute({ content: "test", path: "readonly/test.txt" }));

    chmodSync(roDir, 0o755);

    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(result).toHaveProperty("isError", true);
    expect(result).toHaveProperty("result");
    expect(isToolResult(result)).toBe(true);
    if (isToolResult(result)) {
      expect(typeof result.result).toBe("string");
    }
  });

  test("success case returns result without isError", async () => {
    const exit = await run(tools.writeFile.execute({ content: "hello", path: "test.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(isToolResult(result) && result.isError).toBe(false);
    expect(result).toHaveProperty("result");
    if (isToolResult(result)) {
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
    }
  });
});

describe("ToolOutput Error Handling - editFile", () => {
  const tools = createFsTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  test("oldString not found returns result with isError: true", async () => {
    writeFileSync(join(TEST_DIR, "edit.txt"), "hello world");
    const exit = await run(
      tools.editFile.execute({
        newString: "replacement",
        oldString: "notfound",
        path: "edit.txt",
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(result).toHaveProperty("isError", true);
    expect(result).toHaveProperty("result");
    expect(isToolResult(result)).toBe(true);
    if (isToolResult(result)) {
      expect(typeof result.result).toBe("string");
      expect(result.result).toContain("not found");
    }
  });

  test("success case returns result without isError", async () => {
    writeFileSync(join(TEST_DIR, "edit.txt"), "hello world");
    const exit = await run(
      tools.editFile.execute({
        newString: "goodbye",
        oldString: "hello",
        path: "edit.txt",
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(isToolResult(result) && result.isError).toBe(false);
    expect(result).toHaveProperty("result");
    if (isToolResult(result)) {
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
      expect(parsed.replacements).toBe(1);
    }
  });
});

describe("ToolOutput Error Handling - deleteFile", () => {
  const tools = createFsTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  test("non-existent file returns result with isError: true", async () => {
    const exit = await run(tools.deleteFile.execute({ path: "ghost.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(result).toHaveProperty("isError", true);
    expect(result).toHaveProperty("result");
    expect(isToolResult(result)).toBe(true);
    if (isToolResult(result)) {
      expect(typeof result.result).toBe("string");
      expect(result.result).toContain("not found");
    }
  });

  test("success case returns result without isError", async () => {
    writeFileSync(join(TEST_DIR, "deleteme.txt"), "delete me");
    const exit = await run(tools.deleteFile.execute({ path: "deleteme.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(isToolResult(result) && result.isError).toBe(false);
    expect(result).toHaveProperty("result");
    if (isToolResult(result)) {
      const parsed = JSON.parse(result.result);
      expect(parsed.success).toBe(true);
    }
  });
});

describe("ToolOutput Error Handling - listDir", () => {
  const tools = createFsTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  test("non-existent directory returns result with isError: true", async () => {
    const exit = await run(tools.listDir.execute({ path: "nonexistent" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(result).toHaveProperty("isError", true);
    expect(result).toHaveProperty("result");
    expect(isToolResult(result)).toBe(true);
    if (isToolResult(result)) {
      expect(typeof result.result).toBe("string");
      expect(result.result).toContain("not found");
    }
  });

  test("success case returns result without isError", async () => {
    writeFileSync(join(TEST_DIR, "file.txt"), "content");
    const exit = await run(tools.listDir.execute({ path: "." }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(isToolResult(result) && result.isError).toBe(false);
    expect(result).toHaveProperty("result");
    if (isToolResult(result)) {
      const parsed = JSON.parse(result.result);
      expect(Array.isArray(parsed.entries)).toBe(true);
    }
  });
});

describe("ToolOutput Error Handling - stat", () => {
  const tools = createFsTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  test("non-existent path returns result with isError: true", async () => {
    const exit = await run(tools.stat.execute({ path: "nonexistent.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(result).toHaveProperty("isError", true);
    expect(result).toHaveProperty("result");
    expect(isToolResult(result)).toBe(true);
    if (isToolResult(result)) {
      expect(typeof result.result).toBe("string");
      expect(result.result).toContain("not found");
    }
  });

  test("success case returns result without isError", async () => {
    writeFileSync(join(TEST_DIR, "file.txt"), "content");
    const exit = await run(tools.stat.execute({ path: "file.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = Exit.isSuccess(exit) ? exit.value : null;
    expect(isToolResult(result) && result.isError).toBe(false);
    expect(result).toHaveProperty("result");
    if (isToolResult(result)) {
      const parsed = JSON.parse(result.result);
      expect(parsed.exists).toBe(true);
      expect(parsed.type).toBe("file");
      expect(typeof parsed.size).toBe("number");
    }
  });
});
