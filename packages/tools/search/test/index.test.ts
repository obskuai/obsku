import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect, Exit } from "effect";
import { createSearchTools } from "../src/index";

const TEST_DIR = join(import.meta.dir, "__test_sandbox__");

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

function parseResult(exit: Exit.Exit<unknown, unknown>): any {
  if (!Exit.isSuccess(exit)) {
    return null;
  }
  const wrapped = exit.value as PluginExecutionResult;
  return JSON.parse(wrapped.result);
}

describe("grep", () => {
  const tools = createSearchTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  test("basic regex match", async () => {
    writeFile("a.ts", "const foo = 1;\nconst bar = 2;\nconst foobar = 3;");
    const exit = await run(tools.grep.execute({ path: ".", pattern: "foo" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.results.length).toBe(2);
    expect(result.results[0].file).toBe("a.ts");
    expect(result.results[0].line).toBe(1);
    expect(result.results[0].match).toBe("foo");
    expect(result.results[1].line).toBe(3);
    expect(result.totalFiles).toBe(1);
    expect(result.truncated).toBe(false);
  });

  test("regex pattern with groups", async () => {
    writeFile("b.ts", "import { Effect } from 'effect';\nimport { pipe } from 'effect';");
    const exit = await run(tools.grep.execute({ path: ".", pattern: "import.*from" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.results.length).toBe(2);
    expect(result.results[0].match).toContain("import");
  });

  test("no match returns empty results", async () => {
    writeFile("c.ts", "nothing here");
    const exit = await run(tools.grep.execute({ path: ".", pattern: "zzz_missing" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.results.length).toBe(0);
    expect(result.totalFiles).toBe(1);
    expect(result.truncated).toBe(false);
  });

  test("literal string match (useRegex=false)", async () => {
    writeFile("d.ts", "a.b.c\na*b*c\na+b+c");
    const exit = await run(tools.grep.execute({ path: ".", pattern: "a.b.c", useRegex: false }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.results.length).toBe(1);
    expect(result.results[0].line).toBe(1);
    expect(result.results[0].match).toBe("a.b.c");
  });

  test("include pattern filters files", async () => {
    writeFile("src/x.ts", "match here");
    writeFile("src/y.js", "match here");
    writeFile("src/z.md", "match here");
    const exit = await run(tools.grep.execute({ include: "*.ts", path: ".", pattern: "match" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.results.length).toBe(1);
    expect(result.results[0].file).toContain("x.ts");
  });

  test("exclude patterns filter files", async () => {
    writeFile("src/main.ts", "search me");
    writeFile("node_modules/dep/index.ts", "search me");
    writeFile("src/main.test.ts", "search me");
    const exit = await run(
      tools.grep.execute({
        exclude: ["node_modules", "*.test.ts"],
        path: ".",
        pattern: "search",
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.results.length).toBe(1);
    expect(result.results[0].file).toContain("main.ts");
    expect(result.results[0].file).not.toContain("test");
  });

  test("context lines (before/after)", async () => {
    writeFile("ctx.ts", "line1\nline2\nMATCH\nline4\nline5");
    const exit = await run(tools.grep.execute({ contextLines: 2, path: ".", pattern: "MATCH" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.results.length).toBe(1);
    expect(result.results[0].context).toBeDefined();
    expect(result.results[0].context.before).toEqual(["line1", "line2"]);
    expect(result.results[0].context.after).toEqual(["line4", "line5"]);
  });

  test("context lines at file boundary", async () => {
    writeFile("edge.ts", "MATCH\nline2");
    const exit = await run(tools.grep.execute({ contextLines: 3, path: ".", pattern: "MATCH" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.results[0].context.before).toEqual([]);
    expect(result.results[0].context.after).toEqual(["line2"]);
  });

  test("no context when contextLines=0", async () => {
    writeFile("noctx.ts", "before\nMATCH\nafter");
    const exit = await run(tools.grep.execute({ path: ".", pattern: "MATCH" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.results[0].context).toBeUndefined();
  });

  test("maxResults caps results and sets truncated", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `match_line_${i}`).join("\n");
    writeFile("big.ts", lines);
    const exit = await run(tools.grep.execute({ maxResults: 5, path: ".", pattern: "match_line" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.results.length).toBe(5);
    expect(result.truncated).toBe(true);
  });

  test("path traversal blocked", async () => {
    const exit = await run(tools.grep.execute({ path: "../../etc", pattern: "secret" }));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("column position is correct", async () => {
    writeFile("col.ts", "    foo bar");
    const exit = await run(tools.grep.execute({ path: ".", pattern: "bar" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.results[0].column).toBe(9);
  });

  test("searches subdirectories recursively", async () => {
    writeFile("a/b/c/deep.ts", "found_deep");
    const exit = await run(tools.grep.execute({ path: ".", pattern: "found_deep" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.results.length).toBe(1);
    expect(result.results[0].file).toContain("deep.ts");
  });
});

describe("glob", () => {
  const tools = createSearchTools(TEST_DIR);
  beforeEach(setup);
  afterEach(teardown);

  test("basic pattern **/*.ts", async () => {
    writeFile("src/a.ts", "a");
    writeFile("src/b.js", "b");
    writeFile("src/sub/c.ts", "c");
    const exit = await run(tools.glob.execute({ pattern: "**/*.ts" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.files.length).toBe(2);
    const names = result.files.map((f: any) => f.name).sort();
    expect(names).toEqual(["a.ts", "c.ts"]);
    expect(result.truncated).toBe(false);
  });

  test("pattern *.ts at root level", async () => {
    writeFile("root.ts", "r");
    writeFile("root.js", "j");
    writeFile("sub/nested.ts", "n");
    const exit = await run(tools.glob.execute({ pattern: "*.ts" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.files.length).toBe(1);
    expect(result.files[0].name).toBe("root.ts");
  });

  test("gitignore respect", async () => {
    writeFile(".gitignore", "dist/\n*.log\n");
    writeFile("src/ok.ts", "ok");
    writeFile("dist/bundle.js", "b");
    writeFile("debug.log", "log");
    const exit = await run(tools.glob.execute({ gitignore: true, pattern: "**/*" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    const names = result.files.map((f: any) => f.name);
    expect(names).toContain("ok.ts");
    expect(names).not.toContain("bundle.js");
    expect(names).not.toContain("debug.log");
  });

  test("gitignore disabled", async () => {
    writeFile(".gitignore", "*.log\n");
    writeFile("app.log", "log");
    writeFile("app.ts", "ts");
    const exit = await run(tools.glob.execute({ gitignore: false, pattern: "**/*" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    const names = result.files.map((f: any) => f.name);
    expect(names).toContain("app.log");
    expect(names).toContain("app.ts");
  });

  test("maxResults caps and sets truncated", async () => {
    for (let i = 0; i < 10; i++) {
      writeFile(`file${i}.ts`, `content ${i}`);
    }
    const exit = await run(tools.glob.execute({ maxResults: 3, pattern: "**/*.ts" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.files.length).toBe(3);
    expect(result.truncated).toBe(true);
  });

  test("path traversal blocked", async () => {
    const exit = await run(tools.glob.execute({ path: "../../../etc", pattern: "**/*" }));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("returns relative path and name", async () => {
    writeFile("src/components/Button.tsx", "btn");
    const exit = await run(tools.glob.execute({ pattern: "**/*.tsx" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.files.length).toBe(1);
    expect(result.files[0].name).toBe("Button.tsx");
    expect(result.files[0].path).toBe(join("src", "components", "Button.tsx"));
  });

  test("empty directory returns no files", async () => {
    mkdirSync(join(TEST_DIR, "empty"), { recursive: true });
    const exit = await run(tools.glob.execute({ path: "empty", pattern: "**/*.ts" }));
    expect(Exit.isSuccess(exit)).toBe(true);
    const result = parseResult(exit);
    expect(result.files.length).toBe(0);
    expect(result.truncated).toBe(false);
  });
});

describe("createSearchTools", () => {
  test("returns grep and glob tools", () => {
    const tools = createSearchTools(TEST_DIR);
    expect(tools.grep.name).toBe("grep");
    expect(tools.glob.name).toBe("glob");
  });
});
