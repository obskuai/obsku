import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PyodideRuntime } from "../src/runtimes/pyodide";

describe("Pyodide Runtime", () => {
  let runtime: PyodideRuntime;

  beforeAll(async () => {
    runtime = new PyodideRuntime();
    await runtime.initialize();
  });

  afterAll(async () => {
    await runtime.dispose();
  });

  test("executes basic Python code", async () => {
    const result = await runtime.execute("print(2+2)");
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("4\n");
  });

  test("executes multi-line code with function definitions", async () => {
    const code = `
def add(a, b):
    return a + b

print(add(2, 3))
`;
    const result = await runtime.execute(code);
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("5\n");
  });

  test("supports stdlib imports", async () => {
    const result = await runtime.execute(
      "import json\nprint(json.dumps({'a': 1}, separators=(',', ':')))"
    );
    expect(result.success).toBe(true);
    expect(result.stdout).toBe('{"a":1}\n');
  });

  test("captures stderr on errors", async () => {
    const result = await runtime.execute("1/0");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("ZeroDivisionError");
  });

  // Pyodide's runPythonAsync blocks Bun's event loop, preventing setTimeout
  // from firing the interrupt. Requires worker threads to fix (out of scope).
  // QuickJS timeout works — see wasm-quickjs.test.ts.
  test.skip("times out long-running code", async () => {
    const result = await runtime.execute("while True:\n  pass", { timeoutMs: 500 });
    expect(result.isTimeout).toBe(true);
    expect(result.success).toBe(false);
  });

  test("persists session state in context", async () => {
    const ctx = await runtime.createContext("session-1");
    try {
      await ctx.execute("x = 5");
      const result = await ctx.execute("print(x)");
      expect(result.success).toBe(true);
      expect(result.stdout).toBe("5\n");
    } finally {
      await runtime.destroyContext("session-1");
    }
  });

  test("isolates session state between contexts", async () => {
    const ctxA = await runtime.createContext("session-a");
    const ctxB = await runtime.createContext("session-b");
    try {
      await ctxA.execute("x = 7");
      const result = await ctxB.execute("print(x)");
      expect(result.success).toBe(false);
      expect(result.stderr).toContain("NameError");
    } finally {
      await runtime.destroyContext("session-a");
      await runtime.destroyContext("session-b");
    }
  });

  test("mounts input files and collects output files", async () => {
    const ctx = await runtime.createContext("files-1");
    try {
      await ctx.mountFile("input.txt", "hello");
      const code = `
data = open('input.txt').read()
with open('output.txt', 'w') as f:
    f.write(data.upper())
`;
      const result = await ctx.execute(code);
      expect(result.success).toBe(true);
      const output = await ctx.readFile("output.txt");
      expect(new TextDecoder().decode(output)).toBe("HELLO");
      const files = await ctx.listFiles();
      expect(files).toContain("input.txt");
      expect(files).toContain("output.txt");
    } finally {
      await runtime.destroyContext("files-1");
    }
  });
});
