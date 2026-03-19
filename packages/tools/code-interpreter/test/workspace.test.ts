import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { createWorkspace, PathTraversalError } from "../src/workspace";

describe("createWorkspace", () => {
  test("creates temp directory with obsku-code- prefix", async () => {
    const workspace = await createWorkspace();
    expect(workspace.dir).toContain("obsku-code-");
    expect(existsSync(workspace.dir)).toBe(true);
    await workspace.cleanup();
  });

  test("cleanup removes temp directory", async () => {
    const workspace = await createWorkspace();
    expect(existsSync(workspace.dir)).toBe(true);
    await workspace.cleanup();
    expect(existsSync(workspace.dir)).toBe(false);
  });
});

describe("stageFile", () => {
  test("writes string content to file", async () => {
    const workspace = await createWorkspace();
    const filePath = await workspace.stageFile("test.txt", "hello world");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8")).toBe("hello world");
    await workspace.cleanup();
  });

  test("writes Uint8Array content to file", async () => {
    const workspace = await createWorkspace();
    const content = new Uint8Array([104, 101, 108, 108, 111]);
    const filePath = await workspace.stageFile("binary.bin", content);
    expect(existsSync(filePath)).toBe(true);
    const readContent = readFileSync(filePath);
    expect(readContent.toString()).toBe("hello");
    await workspace.cleanup();
  });

  test("returns absolute path", async () => {
    const workspace = await createWorkspace();
    const filePath = await workspace.stageFile("test.txt", "content");
    expect(isAbsolute(filePath)).toBe(true);
    expect(filePath).toBe(join(workspace.dir, "test.txt"));
    await workspace.cleanup();
  });

  test("blocks absolute path traversal", async () => {
    const workspace = await createWorkspace();
    expect(() => workspace.stageFile("/etc/passwd", "evil")).toThrow(PathTraversalError);
    await workspace.cleanup();
  });

  test("blocks relative path traversal with ../", async () => {
    const workspace = await createWorkspace();
    expect(() => workspace.stageFile("../escape.txt", "evil")).toThrow(PathTraversalError);
    await workspace.cleanup();
  });

  test("blocks relative path traversal with ..\\", async () => {
    const workspace = await createWorkspace();
    expect(() => workspace.stageFile(String.raw`..\escape.txt`, "evil")).toThrow(
      PathTraversalError
    );
    await workspace.cleanup();
  });

  test("blocks nested path traversal", async () => {
    const workspace = await createWorkspace();
    expect(() => workspace.stageFile("sub/../../../etc/passwd", "evil")).toThrow(
      PathTraversalError
    );
    await workspace.cleanup();
  });

  test("allows safe nested paths", async () => {
    const workspace = await createWorkspace();
    const filePath = await workspace.stageFile("sub/deep/file.txt", "nested");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8")).toBe("nested");
    await workspace.cleanup();
  });
});

describe("collectOutputFiles", () => {
  test("collects all files in workspace", async () => {
    const workspace = await createWorkspace();
    await workspace.stageFile("file1.txt", "content1");
    await workspace.stageFile("file2.txt", "content2");

    const outputs = await workspace.collectOutputFiles([]);
    expect(outputs.size).toBe(2);
    expect(new TextDecoder().decode(outputs.get("file1.txt"))).toBe("content1");
    expect(new TextDecoder().decode(outputs.get("file2.txt"))).toBe("content2");
    await workspace.cleanup();
  });

  test("excludes specified input files", async () => {
    const workspace = await createWorkspace();
    await workspace.stageFile("input.txt", "input data");
    await workspace.stageFile("output.txt", "output data");

    const outputs = await workspace.collectOutputFiles(["input.txt"]);
    expect(outputs.size).toBe(1);
    expect(outputs.has("input.txt")).toBe(false);
    expect(outputs.has("output.txt")).toBe(true);
    await workspace.cleanup();
  });

  test("returns empty map when all files excluded", async () => {
    const workspace = await createWorkspace();
    await workspace.stageFile("file1.txt", "content1");
    await workspace.stageFile("file2.txt", "content2");

    const outputs = await workspace.collectOutputFiles(["file1.txt", "file2.txt"]);
    expect(outputs.size).toBe(0);
    await workspace.cleanup();
  });

  test("skips directories (flat files only)", async () => {
    const workspace = await createWorkspace();
    await workspace.stageFile("file.txt", "content");
    mkdirSync(join(workspace.dir, "emptydir"));

    const outputs = await workspace.collectOutputFiles([]);
    expect(outputs.size).toBe(1);
    expect(outputs.has("file.txt")).toBe(true);
    expect(outputs.has("emptydir")).toBe(false);
    await workspace.cleanup();
  });

  test("returns Uint8Array content", async () => {
    const workspace = await createWorkspace();
    await workspace.stageFile("binary.bin", new Uint8Array([0, 1, 2, 3]));

    const outputs = await workspace.collectOutputFiles([]);
    const content = outputs.get("binary.bin");
    expect(content).toBeInstanceOf(Uint8Array);
    expect(content).toEqual(new Uint8Array([0, 1, 2, 3]));
    await workspace.cleanup();
  });
});

describe("PathTraversalError", () => {
  test("has correct _tag", () => {
    const error = new PathTraversalError("../evil.txt");
    expect(error._tag).toBe("PathTraversalError");
  });

  test("has correct name", () => {
    const error = new PathTraversalError("../evil.txt");
    expect(error.name).toBe("PathTraversalError");
  });

  test("stores requested path", () => {
    const error = new PathTraversalError("../evil.txt");
    expect(error.requestedPath).toBe("../evil.txt");
  });

  test("has descriptive message", () => {
    const error = new PathTraversalError("../evil.txt");
    expect(error.message).toContain("../evil.txt");
    expect(error.message).toContain("Path traversal blocked");
  });
});
