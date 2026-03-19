import { describe, expect, test } from "bun:test";
import { MAX_INPUT_FILE_BYTES } from "@obsku/tool-code-interpreter";
import {
  createWasmWorkspace,
  FileSizeLimitError,
  OutputSizeLimitError,
  PathTraversalError,
} from "../src/wasm-workspace";

describe("createWasmWorkspace", () => {
  test("creates workspace with virtual dir", async () => {
    const ws = await createWasmWorkspace();
    expect(ws.dir).toMatch(/^\/wasm-workspace\//);
    await ws.cleanup();
  });

  test("each workspace has a unique dir", async () => {
    const ws1 = await createWasmWorkspace();
    const ws2 = await createWasmWorkspace();
    expect(ws1.dir).not.toBe(ws2.dir);
    await ws1.cleanup();
    await ws2.cleanup();
  });

  test("cleanup clears all staged files", async () => {
    const ws = await createWasmWorkspace();
    await ws.stageFile("file.txt", "content");
    await ws.cleanup();
    const outputs = await ws.collectOutputFiles([]);
    expect(outputs.size).toBe(0);
  });
});

describe("stageFile", () => {
  test("stores string content and returns virtual path", async () => {
    const ws = await createWasmWorkspace();
    const p = await ws.stageFile("hello.txt", "hello world");
    expect(p).toBe(`${ws.dir}/hello.txt`);
    await ws.cleanup();
  });

  test("stored string can be retrieved via collectOutputFiles", async () => {
    const ws = await createWasmWorkspace();
    await ws.stageFile("hello.txt", "hello world");
    const outputs = await ws.collectOutputFiles([]);
    const data = outputs.get("hello.txt");
    expect(data).toBeDefined();
    expect(new TextDecoder().decode(data)).toBe("hello world");
    await ws.cleanup();
  });

  test("binary Uint8Array roundtrip", async () => {
    const ws = await createWasmWorkspace();
    const binary = new Uint8Array([0x00, 0x01, 0xfe, 0xff, 0x42]);
    await ws.stageFile("binary.bin", binary);
    const outputs = await ws.collectOutputFiles([]);
    const data = outputs.get("binary.bin");
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data).toEqual(binary);
    await ws.cleanup();
  });

  test("returns absolute virtual path", async () => {
    const ws = await createWasmWorkspace();
    const p = await ws.stageFile("data.csv", "a,b,c");
    expect(p.startsWith("/")).toBe(true);
    expect(p).toContain(ws.dir);
    await ws.cleanup();
  });

  test("blocks absolute path traversal /etc/passwd", async () => {
    const ws = await createWasmWorkspace();
    expect(() => ws.stageFile("/etc/passwd", "evil")).toThrow(PathTraversalError);
    await ws.cleanup();
  });

  test("blocks ../../../etc/passwd path traversal", async () => {
    const ws = await createWasmWorkspace();
    expect(() => ws.stageFile("../../../etc/passwd", "evil")).toThrow(PathTraversalError);
    await ws.cleanup();
  });

  test("blocks ../ relative traversal", async () => {
    const ws = await createWasmWorkspace();
    expect(() => ws.stageFile("../escape.txt", "evil")).toThrow(PathTraversalError);
    await ws.cleanup();
  });

  test(String.raw`blocks ..\ Windows-style traversal`, async () => {
    const ws = await createWasmWorkspace();
    expect(() => ws.stageFile(String.raw`..\escape.txt`, "evil")).toThrow(PathTraversalError);
    await ws.cleanup();
  });

  test("blocks nested traversal sub/../../../etc/shadow", async () => {
    const ws = await createWasmWorkspace();
    expect(() => ws.stageFile("sub/../../../etc/shadow", "evil")).toThrow(PathTraversalError);
    await ws.cleanup();
  });

  test("allows safe nested path sub/deep/file.txt", async () => {
    const ws = await createWasmWorkspace();
    const p = await ws.stageFile("sub/deep/file.txt", "nested");
    expect(p).toContain("sub/deep/file.txt");
    const outputs = await ws.collectOutputFiles([]);
    expect(outputs.has("sub/deep/file.txt")).toBe(true);
    await ws.cleanup();
  });

  test("enforces 10MB input size limit (string too large)", async () => {
    const ws = await createWasmWorkspace();
    const big = "x".repeat(MAX_INPUT_FILE_BYTES + 1);
    await expect(ws.stageFile("big.txt", big)).rejects.toThrow(FileSizeLimitError);
    await ws.cleanup();
  });

  test("enforces 10MB input size limit (Uint8Array too large)", async () => {
    const ws = await createWasmWorkspace();
    const big = new Uint8Array(MAX_INPUT_FILE_BYTES + 1);
    await expect(ws.stageFile("big.bin", big)).rejects.toThrow(FileSizeLimitError);
    await ws.cleanup();
  });

  test("accepts file exactly at 10MB limit", async () => {
    const ws = await createWasmWorkspace();
    const exact = new Uint8Array(MAX_INPUT_FILE_BYTES);
    const p = await ws.stageFile("exact.bin", exact);
    expect(p).toContain("exact.bin");
    await ws.cleanup();
  });
});

describe("collectOutputFiles", () => {
  test("returns all staged files", async () => {
    const ws = await createWasmWorkspace();
    await ws.stageFile("a.txt", "aaa");
    await ws.stageFile("b.txt", "bbb");
    const outputs = await ws.collectOutputFiles([]);
    expect(outputs.size).toBe(2);
    await ws.cleanup();
  });

  test("excludes specified input files", async () => {
    const ws = await createWasmWorkspace();
    await ws.stageFile("input.txt", "input");
    await ws.stageFile("output.txt", "output");
    const outputs = await ws.collectOutputFiles(["input.txt"]);
    expect(outputs.size).toBe(1);
    expect(outputs.has("input.txt")).toBe(false);
    expect(outputs.has("output.txt")).toBe(true);
    await ws.cleanup();
  });

  test("returns empty map when all files excluded", async () => {
    const ws = await createWasmWorkspace();
    await ws.stageFile("a.txt", "aaa");
    await ws.stageFile("b.txt", "bbb");
    const outputs = await ws.collectOutputFiles(["a.txt", "b.txt"]);
    expect(outputs.size).toBe(0);
    await ws.cleanup();
  });

  test("returns Uint8Array values", async () => {
    const ws = await createWasmWorkspace();
    await ws.stageFile("bin.bin", new Uint8Array([1, 2, 3]));
    const outputs = await ws.collectOutputFiles([]);
    const val = outputs.get("bin.bin");
    expect(val).toBeInstanceOf(Uint8Array);
    expect(val).toEqual(new Uint8Array([1, 2, 3]));
    await ws.cleanup();
  });

  test("enforces 50MB total output limit", async () => {
    const ws = await createWasmWorkspace();
    const chunk = new Uint8Array(9 * 1024 * 1024);
    await ws.stageFile("file1.bin", chunk);
    await ws.stageFile("file2.bin", chunk);
    await ws.stageFile("file3.bin", chunk);
    await ws.stageFile("file4.bin", chunk);
    await ws.stageFile("file5.bin", chunk);
    await ws.stageFile("file6.bin", chunk);
    await expect(ws.collectOutputFiles([])).rejects.toThrow(OutputSizeLimitError);
    await ws.cleanup();
  });
});

describe("mountToEmscriptenFS", () => {
  test("calls writeFile for each staged file", async () => {
    const ws = await createWasmWorkspace();
    await ws.stageFile("script.py", "print('hello')");
    await ws.stageFile("data.bin", new Uint8Array([1, 2, 3]));

    const writtenFiles: Record<string, Uint8Array> = {};
    const mockFS = {
      mkdir: (_path: string) => {},
      writeFile: (path: string, data: Uint8Array) => {
        writtenFiles[path] = data;
      },
    };

    await ws.mountToEmscriptenFS(mockFS);

    const keys = Object.keys(writtenFiles);
    expect(keys.length).toBe(2);
    expect(keys.some((k) => k.endsWith("script.py"))).toBe(true);
    expect(keys.some((k) => k.endsWith("data.bin"))).toBe(true);
    await ws.cleanup();
  });

  test("calls mkdir for the workspace dir", async () => {
    const ws = await createWasmWorkspace();
    await ws.stageFile("a.txt", "a");

    const mkdirCalls: Array<string> = [];
    const mockFS = {
      mkdir: (path: string) => {
        mkdirCalls.push(path);
      },
      writeFile: (_path: string, _data: Uint8Array) => {},
    };

    await ws.mountToEmscriptenFS(mockFS);
    expect(mkdirCalls.some((p) => p === ws.dir)).toBe(true);
    await ws.cleanup();
  });
});

describe("syncFromEmscriptenFS", () => {
  test("reads files from Emscripten FS into the workspace store", async () => {
    const ws = await createWasmWorkspace();

    const fakeFiles: Record<string, Uint8Array> = {
      "output.bin": new Uint8Array([10, 20, 30]),
      "result.txt": new TextEncoder().encode("computation result"),
    };

    const mockFS = {
      isFile: (mode: number) => (mode & 0o17_0000) === 0o10_0000,
      readdir: (_dir: string) => [".", "..", "result.txt", "output.bin"],
      readFile: (p: string): Uint8Array => {
        const name = p.split("/").at(-1)!;
        return fakeFiles[name] ?? new Uint8Array(0);
      },
      stat: (_p: string) => ({ mode: 0o10_0644 }),
    };

    await ws.syncFromEmscriptenFS(mockFS, ws.dir);

    const outputs = await ws.collectOutputFiles([]);
    expect(outputs.has("result.txt")).toBe(true);
    expect(outputs.has("output.bin")).toBe(true);
    expect(new TextDecoder().decode(outputs.get("result.txt")!)).toBe("computation result");
    await ws.cleanup();
  });
});

describe("toQuickJSGlobals", () => {
  test("returns plain object with all staged files as Uint8Array", async () => {
    const ws = await createWasmWorkspace();
    await ws.stageFile("code.js", "console.log('hi')");
    await ws.stageFile("data.bin", new Uint8Array([7, 8, 9]));

    const globals = ws.toQuickJSGlobals();
    expect(typeof globals).toBe("object");
    expect(globals["code.js"]).toBeInstanceOf(Uint8Array);
    expect(globals["data.bin"]).toBeInstanceOf(Uint8Array);
    expect(globals["data.bin"]).toEqual(new Uint8Array([7, 8, 9]));
    await ws.cleanup();
  });

  test("returns empty object when no files staged", async () => {
    const ws = await createWasmWorkspace();
    const globals = ws.toQuickJSGlobals();
    expect(Object.keys(globals).length).toBe(0);
    await ws.cleanup();
  });
});
