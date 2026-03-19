import { describe, expect, test } from "bun:test";
import { QuickJSRuntime } from "../src/runtimes/quickjs";
import { createWasmWorkspace, PathTraversalError } from "../src/wasm-workspace";

describe("Wasm code interpreter security", () => {
  test("path traversal rejected in wasm workspace", async () => {
    const workspace = await createWasmWorkspace();
    await Promise.all([
      expect(workspace.stageFile("../escape.txt", "content")).rejects.toThrow(PathTraversalError),
      expect(workspace.stageFile("/absolute/path.txt", "content")).rejects.toThrow(
        PathTraversalError
      ),
    ]);
    await workspace.cleanup();
  });

  test("timeout enforcement via QuickJS runtime", async () => {
    const runtime = new QuickJSRuntime();
    await runtime.initialize();
    const result = await runtime.execute("while (true) {}", { timeoutMs: 200 });
    expect(result.success).toBe(false);
    expect(result.isTimeout).toBe(true);
    await runtime.dispose();
  });

  test("memory limit enforcement via QuickJS runtime", async () => {
    const runtime = new QuickJSRuntime();
    await runtime.initialize();
    const result = await runtime.execute(
      "const data = new Array(10_000_000).fill(1); console.log(data.length);",
      { memoryLimitMb: 4 }
    );
    expect(result.success).toBe(false);
    expect(result.stderr.toLowerCase()).toContain("memory");
    await runtime.dispose();
  });

  test("sandbox prevents access to host process/fs", async () => {
    const runtime = new QuickJSRuntime();
    await runtime.initialize();
    const result = await runtime.execute(
      `
        let fsAccess = "ok";
        try {
          require("fs");
        } catch (err) {
          fsAccess = "blocked";
        }
        console.log(String(typeof process) + "," + fsAccess);
      `
    );
    expect(result.stdout.trim()).toBe("undefined,blocked");
    await runtime.dispose();
  });
});
