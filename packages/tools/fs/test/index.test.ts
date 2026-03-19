import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect, Exit } from "effect";
import { createFsTools, PathTraversalError, SymlinkEscapeError, validatePath } from "../src/index";

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

// Helper to extract and parse the result string
function getResult<T>(value: unknown): T | string | unknown {
  if (isToolResult(value)) {
    try {
      return JSON.parse(value.result) as T;
    } catch {
      return value.result;
    }
  }
  return value;
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

describe("validatePath", () => {
  beforeEach(setup);
  afterEach(teardown);

  test("allows valid relative path", () => {
    writeFileSync(join(TEST_DIR, "ok.txt"), "ok");
    const result = validatePath(TEST_DIR, "ok.txt");
    expect(result).toBe(join(TEST_DIR, "ok.txt"));
  });

  test("blocks path traversal with ../", () => {
    expect(() => validatePath(TEST_DIR, "../../../etc/passwd")).toThrow(PathTraversalError);
  });

  test("blocks path traversal with absolute path outside base", () => {
    expect(() => validatePath(TEST_DIR, "/etc/passwd")).toThrow(PathTraversalError);
  });

  test("blocks symlink escape", () => {
    const linkPath = join(TEST_DIR, "escape-link");
    symlinkSync("/tmp", linkPath);
    expect(() => validatePath(TEST_DIR, "escape-link")).toThrow(SymlinkEscapeError);
  });

  test("allows symlink within basePath", () => {
    const targetFile = join(TEST_DIR, "real.txt");
    writeFileSync(targetFile, "real");
    const linkPath = join(TEST_DIR, "safe-link");
    symlinkSync(targetFile, linkPath);
    const result = validatePath(TEST_DIR, "safe-link");
    expect(result).toBe(linkPath);
  });

  test("allows path to basePath itself", () => {
    const result = validatePath(TEST_DIR, ".");
    expect(result).toBe(resolve(TEST_DIR));
  });
});

describe("readFile", () => {
  const tools = createFsTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  test("reads file content", async () => {
    writeFileSync(join(TEST_DIR, "hello.txt"), "line1\nline2\nline3");
    const exit = await run(tools.readFile.execute({ path: "hello.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = getResult<{
      content: string;
      totalLines: number;
      truncated: boolean;
    }>(Exit.isSuccess(exit) ? exit.value : null);
    if (typeof result === "object" && result !== null) {
      expect(result.content).toBe("line1\nline2\nline3");
      expect(result.totalLines).toBe(3);
      expect(result.truncated).toBe(false);
    }
  });

  test("reads with offset", async () => {
    writeFileSync(join(TEST_DIR, "lines.txt"), "a\nb\nc\nd\ne");
    const exit = await run(tools.readFile.execute({ offset: 3, path: "lines.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = getResult<{ content: string }>(Exit.isSuccess(exit) ? exit.value : null);
    if (typeof result === "object" && result !== null) {
      expect(result.content).toBe("c\nd\ne");
    }
  });

  test("reads with limit", async () => {
    writeFileSync(join(TEST_DIR, "lines.txt"), "a\nb\nc\nd\ne");
    const exit = await run(tools.readFile.execute({ limit: 2, path: "lines.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = getResult<{ content: string; truncated: boolean }>(
      Exit.isSuccess(exit) ? exit.value : null
    );
    if (typeof result === "object" && result !== null) {
      expect(result.content).toBe("a\nb");
      expect(result.truncated).toBe(true);
    }
  });

  test("reads with offset + limit", async () => {
    writeFileSync(join(TEST_DIR, "lines.txt"), "a\nb\nc\nd\ne");
    const exit = await run(tools.readFile.execute({ limit: 2, offset: 2, path: "lines.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = getResult<{ content: string; truncated: boolean }>(
      Exit.isSuccess(exit) ? exit.value : null
    );
    if (typeof result === "object" && result !== null) {
      expect(result.content).toBe("b\nc");
      expect(result.truncated).toBe(true);
    }
  });

  test("blocks path traversal", async () => {
    const exit = await run(tools.readFile.execute({ path: "../../etc/passwd" }));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("writeFile", () => {
  const tools = createFsTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  test("creates new file", async () => {
    const exit = await run(tools.writeFile.execute({ content: "hello", path: "new.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(readFileSync(join(TEST_DIR, "new.txt"), "utf8")).toBe("hello");
  });

  test("overwrites existing file", async () => {
    writeFileSync(join(TEST_DIR, "exist.txt"), "old");
    const exit = await run(tools.writeFile.execute({ content: "new", path: "exist.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(readFileSync(join(TEST_DIR, "exist.txt"), "utf8")).toBe("new");
  });

  test("creates parent dirs with createDirs", async () => {
    const exit = await run(
      tools.writeFile.execute({ content: "deep", createDirs: true, path: "sub/deep/file.txt" })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(readFileSync(join(TEST_DIR, "sub/deep/file.txt"), "utf8")).toBe("deep");
  });

  test("fails without createDirs for missing parent", async () => {
    const exit = await run(tools.writeFile.execute({ content: "fail", path: "missing/file.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const value = Exit.isSuccess(exit) ? exit.value : null;
    expect(isToolResult(value) && value.isError).toBe(true);
  });

  test("blocks path traversal", async () => {
    const exit = await run(tools.writeFile.execute({ content: "pwned", path: "../../evil.txt" }));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("editFile", () => {
  const tools = createFsTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  test("search/replace single occurrence", async () => {
    writeFileSync(join(TEST_DIR, "edit.txt"), "hello world");
    const exit = await run(
      tools.editFile.execute({ newString: "goodbye", oldString: "hello", path: "edit.txt" })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = getResult<{ replacements: number }>(Exit.isSuccess(exit) ? exit.value : null);
    if (typeof result === "object" && result !== null) {
      expect(result.replacements).toBe(1);
    }
    expect(readFileSync(join(TEST_DIR, "edit.txt"), "utf8")).toBe("goodbye world");
  });

  test("replaces all occurrences", async () => {
    writeFileSync(join(TEST_DIR, "multi.txt"), "aaa bbb aaa ccc aaa");
    const exit = await run(
      tools.editFile.execute({ newString: "zzz", oldString: "aaa", path: "multi.txt" })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = getResult<{ replacements: number }>(Exit.isSuccess(exit) ? exit.value : null);
    if (typeof result === "object" && result !== null) {
      expect(result.replacements).toBe(3);
    }
    expect(readFileSync(join(TEST_DIR, "multi.txt"), "utf8")).toBe("zzz bbb zzz ccc zzz");
  });

  test("returns error when oldString not found", async () => {
    writeFileSync(join(TEST_DIR, "nope.txt"), "nothing here");
    const exit = await run(
      tools.editFile.execute({ newString: "x", oldString: "missing", path: "nope.txt" })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const value = Exit.isSuccess(exit) ? exit.value : null;
    expect(isToolResult(value) && value.isError).toBe(true);
  });

  test("directive: comment-review match detects comments", () => {
    const directive = tools.editFile.directives![0];
    expect(directive.name).toBe("comment-review");
    expect(directive.match("const x = 1; // comment", {})).toBe(true);
    expect(directive.match("/* block */", {})).toBe(true);
    expect(directive.match("no comments here", {})).toBe(false);
  });

  test("directive: comment-review injects guidance string", () => {
    const directive = tools.editFile.directives![0];
    expect(typeof directive.inject).toBe("string");
    expect((directive.inject as string).toLowerCase()).toContain("comment");
  });
});

describe("listDir", () => {
  const tools = createFsTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  test("lists directory contents", async () => {
    writeFileSync(join(TEST_DIR, "a.txt"), "a");
    writeFileSync(join(TEST_DIR, "b.txt"), "b");
    mkdirSync(join(TEST_DIR, "subdir"));

    const exit = await run(tools.listDir.execute({ path: "." }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = getResult<{ entries: Array<{ name: string; type: string }> }>(
      Exit.isSuccess(exit) ? exit.value : null
    );
    if (typeof result === "object" && result !== null && Array.isArray(result.entries)) {
      const names = result.entries.map((e) => e.name).sort();
      expect(names).toContain("a.txt");
      expect(names).toContain("b.txt");
      expect(names).toContain("subdir");

      const subdir = result.entries.find((e) => e.name === "subdir");
      expect(subdir?.type).toBe("dir");
      const file = result.entries.find((e) => e.name === "a.txt");
      expect(file?.type).toBe("file");
    }
  });

  test("recursive listing", async () => {
    mkdirSync(join(TEST_DIR, "sub"));
    writeFileSync(join(TEST_DIR, "sub/nested.txt"), "nested");
    writeFileSync(join(TEST_DIR, "root.txt"), "root");

    const exit = await run(tools.listDir.execute({ path: ".", recursive: true }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = getResult<{ entries: Array<{ name: string }> }>(
      Exit.isSuccess(exit) ? exit.value : null
    );
    if (typeof result === "object" && result !== null && Array.isArray(result.entries)) {
      const names = result.entries.map((e) => e.name);
      expect(names).toContain("nested.txt");
      expect(names).toContain("root.txt");
      expect(names).toContain("sub");
    }
  });

  test("respects .gitignore", async () => {
    writeFileSync(join(TEST_DIR, ".gitignore"), "ignored.txt\nbuild/\n");
    writeFileSync(join(TEST_DIR, "kept.txt"), "keep");
    writeFileSync(join(TEST_DIR, "ignored.txt"), "ignore");
    mkdirSync(join(TEST_DIR, "build"));
    writeFileSync(join(TEST_DIR, "build/out.js"), "out");

    const exit = await run(tools.listDir.execute({ gitignore: true, path: "." }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = getResult<{ entries: Array<{ name: string }> }>(
      Exit.isSuccess(exit) ? exit.value : null
    );
    if (typeof result === "object" && result !== null && Array.isArray(result.entries)) {
      const names = result.entries.map((e) => e.name);
      expect(names).toContain("kept.txt");
      expect(names).not.toContain("ignored.txt");
      expect(names).not.toContain("build");
    }
  });
});

describe("stat", () => {
  const tools = createFsTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  test("stat file", async () => {
    writeFileSync(join(TEST_DIR, "f.txt"), "content");
    const exit = await run(tools.stat.execute({ path: "f.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = getResult<{
      created: unknown;
      exists: boolean;
      modified: unknown;
      size: number;
      type: string;
    }>(Exit.isSuccess(exit) ? exit.value : null);
    if (typeof result === "object" && result !== null) {
      expect(result.exists).toBe(true);
      expect(result.type).toBe("file");
      expect(result.size).toBe(7);
      expect(result.modified).toBeTruthy();
      expect(result.created).toBeTruthy();
    }
  });

  test("stat directory", async () => {
    mkdirSync(join(TEST_DIR, "mydir"));
    const exit = await run(tools.stat.execute({ path: "mydir" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = getResult<{ exists: boolean; type: string }>(
      Exit.isSuccess(exit) ? exit.value : null
    );
    if (typeof result === "object" && result !== null) {
      expect(result.exists).toBe(true);
      expect(result.type).toBe("dir");
    }
  });

  test("stat non-existent returns error", async () => {
    const exit = await run(tools.stat.execute({ path: "nope.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const value = Exit.isSuccess(exit) ? exit.value : null;
    expect(isToolResult(value) && value.isError).toBe(true);
  });

  test("stat symlink", async () => {
    const target = join(TEST_DIR, "target.txt");
    writeFileSync(target, "target");
    symlinkSync(target, join(TEST_DIR, "link.txt"));

    const exit = await run(tools.stat.execute({ path: "link.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = getResult<{ exists: boolean; type: string }>(
      Exit.isSuccess(exit) ? exit.value : null
    );
    if (typeof result === "object" && result !== null) {
      expect(result.exists).toBe(true);
      expect(result.type).toBe("link");
    }
  });
});

describe("deleteFile", () => {
  const tools = createFsTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  test("deletes existing file", async () => {
    const fp = join(TEST_DIR, "del.txt");
    writeFileSync(fp, "delete me");
    expect(existsSync(fp)).toBe(true);

    const exit = await run(tools.deleteFile.execute({ path: "del.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(existsSync(fp)).toBe(false);
  });

  test("returns error on non-existent file", async () => {
    const exit = await run(tools.deleteFile.execute({ path: "ghost.txt" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const value = Exit.isSuccess(exit) ? exit.value : null;
    expect(isToolResult(value) && value.isError).toBe(true);
  });

  test("blocks path traversal", async () => {
    const exit = await run(tools.deleteFile.execute({ path: "../../danger.txt" }));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("createFsTools", () => {
  test("returns all 6 tools", () => {
    const tools = createFsTools(TEST_DIR);
    expect(tools.readFile.name).toBe("readFile");
    expect(tools.writeFile.name).toBe("writeFile");
    expect(tools.editFile.name).toBe("editFile");
    expect(tools.listDir.name).toBe("listDir");
    expect(tools.stat.name).toBe("stat");
    expect(tools.deleteFile.name).toBe("deleteFile");
  });
});
