import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect, Exit } from "effect";
import { createSearchTools } from "../src/index";

const TEST_DIR = join(import.meta.dir, "__test_sandbox_grep__");

function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromiseExit(effect);
}

function setup() {
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  rmSync(TEST_DIR, { force: true, recursive: true });
}

function writeFile(rel: string, content: string) {
  const full = join(TEST_DIR, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

interface PluginExecutionResult {
  isError?: boolean;
  result: string;
}

describe("grep ToolOutput migration", () => {
  const tools = createSearchTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  describe("invalid regex", () => {
    test("invalid regex pattern returns result with isError:true", async () => {
      const exit = await run(tools.grep.execute({ path: ".", pattern: "[invalid(regex" }));

      expect(Exit.isSuccess(exit)).toBe(true);

      const wrappedResult = Exit.isSuccess(exit) ? (exit.value as PluginExecutionResult) : null;
      expect(wrappedResult).toBeDefined();
      expect(wrappedResult!.isError).toBe(true);
      expect(wrappedResult!.result).toContain("Invalid regex");
    });
  });

  describe("no matches", () => {
    test("no matches should NOT have isError (search worked, just empty)", async () => {
      writeFile("test.ts", "nothing here");
      const exit = await run(tools.grep.execute({ path: ".", pattern: "zzz_missing" }));

      expect(Exit.isSuccess(exit)).toBe(true);

      const wrappedResult = Exit.isSuccess(exit) ? (exit.value as PluginExecutionResult) : null;
      expect(wrappedResult).toBeDefined();
      expect(wrappedResult!.isError).toBe(false);

      const parsed = JSON.parse(wrappedResult!.result);
      expect(parsed.results.length).toBe(0);
      expect(parsed.totalFiles).toBe(1);
      expect(parsed.truncated).toBe(false);
    });
  });

  describe("successful matches", () => {
    test("successful match should NOT have isError", async () => {
      writeFile("a.ts", "const foo = 1;");
      const exit = await run(tools.grep.execute({ path: ".", pattern: "foo" }));

      expect(Exit.isSuccess(exit)).toBe(true);

      const wrappedResult = Exit.isSuccess(exit) ? (exit.value as PluginExecutionResult) : null;
      expect(wrappedResult).toBeDefined();
      expect(wrappedResult!.isError).toBe(false);

      const parsed = JSON.parse(wrappedResult!.result);
      expect(parsed.results.length).toBe(1);
      expect(parsed.totalFiles).toBe(1);
    });
  });

  describe("literal pattern with special chars", () => {
    test("literal pattern should work without regex errors", async () => {
      writeFile("special.ts", "a.b.c\n[test]");
      const exit = await run(tools.grep.execute({ path: ".", pattern: "a.b.c", useRegex: false }));

      expect(Exit.isSuccess(exit)).toBe(true);

      const wrappedResult = Exit.isSuccess(exit) ? (exit.value as PluginExecutionResult) : null;
      expect(wrappedResult).toBeDefined();
      expect(wrappedResult!.isError).toBe(false);

      const parsed = JSON.parse(wrappedResult!.result);
      expect(parsed.results.length).toBe(1);
    });
  });
});
