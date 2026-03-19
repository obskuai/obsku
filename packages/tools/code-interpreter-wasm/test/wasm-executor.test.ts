import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { WasmExecutor } from "../src/wasm-executor";

describe("WasmExecutor", () => {
  let executor: WasmExecutor;

  beforeAll(async () => {
    executor = new WasmExecutor();
    await executor.initialize();
  });

  afterAll(async () => {
    await executor.dispose();
  });

  test("executes javascript and captures stdout", async () => {
    const result = await executor.execute({
      code: "console.log(2 + 2)",
      language: "javascript",
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("4");
  });

  test("transpiles typescript before execution", async () => {
    const result = await executor.execute({
      code: "const x: number = 5; console.log(x);",
      language: "typescript",
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("5");
  });

  test("python file I/O roundtrip", async () => {
    const result = await executor.execute({
      code: `
data = open('input.txt').read()
with open('output.txt', 'w') as f:
    f.write(data.upper())
`,
      inputFiles: new Map([["input.txt", "hello"]]),
      language: "python",
    });
    expect(result.success).toBe(true);
    expect(result.outputFiles).toBeDefined();
    expect(result.outputFiles!.has("output.txt")).toBe(true);
    const output = new TextDecoder().decode(result.outputFiles!.get("output.txt"));
    expect(output).toBe("HELLO");
    expect(result.outputFiles!.has("input.txt")).toBe(false);
  }, 15_000);

  test("session lifecycle create, execute, destroy", async () => {
    const sessionId = "session-1";
    await executor.createSession!(sessionId, { language: "javascript" });

    const init = await executor.execute({
      code: "var x = 5;",
      language: "javascript",
      sessionId,
    });
    expect(init.success).toBe(true);

    const result = await executor.execute({
      code: "console.log(x)",
      language: "javascript",
      sessionId,
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("5");

    await executor.destroySession!(sessionId);

    const after = await executor.execute({
      code: "console.log(x)",
      language: "javascript",
      sessionId,
    });
    expect(after.success).toBe(false);
    expect(after.stderr).toContain("Session");
  });

  test("enforces max concurrent sessions", async () => {
    const limited = new WasmExecutor({ maxConcurrentSessions: 1 });
    await limited.initialize();
    await limited.createSession!("a", { language: "javascript" });
    await expect(limited.createSession!("b", { language: "javascript" })).rejects.toThrow(
      /max concurrent sessions/i
    );
    await limited.dispose();
  });
});
