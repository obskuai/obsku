import { describe, expect, it } from "bun:test";
import { QuickJSRuntime } from "../src/runtimes/quickjs";

describe("QuickJS Runtime", () => {
  it("executes basic JavaScript and captures stdout", async () => {
    const runtime = new QuickJSRuntime();
    await runtime.initialize();
    const result = await runtime.execute("console.log(2 + 2)");
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("4");
    await runtime.dispose();
  });

  it("executes multi-line code with functions", async () => {
    const runtime = new QuickJSRuntime();
    await runtime.initialize();
    const result = await runtime.execute(`
      function add(a, b) {
        return a + b;
      }
      console.log(add(3, 4));
    `);
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("7");
    await runtime.dispose();
  });

  it("captures thrown errors in stderr", async () => {
    const runtime = new QuickJSRuntime();
    await runtime.initialize();
    const result = await runtime.execute(`
      throw new Error("boom");
    `);
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("boom");
    await runtime.dispose();
  });

  it("times out long-running code", async () => {
    const runtime = new QuickJSRuntime();
    await runtime.initialize();
    const result = await runtime.execute("while (true) {}", { timeoutMs: 500 });
    expect(result.success).toBe(false);
    expect(result.isTimeout).toBe(true);
    await runtime.dispose();
  });

  it("enforces memory limits", async () => {
    const runtime = new QuickJSRuntime();
    await runtime.initialize();
    const result = await runtime.execute(
      `
      const data = new Array(10_000_000).fill(1);
      console.log(data.length);
    `,
      { memoryLimitMb: 4 }
    );
    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/memory/i);
    await runtime.dispose();
  });

  it("preserves session state within a context", async () => {
    const runtime = new QuickJSRuntime();
    await runtime.initialize();
    const context = await runtime.createContext("session-1");
    await context.execute("var x = 5;");
    const result = await context.execute("console.log(x)");
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("5");
    await runtime.destroyContext("session-1");
    await runtime.dispose();
  });

  it("isolates state between contexts", async () => {
    const runtime = new QuickJSRuntime();
    await runtime.initialize();
    const ctxA = await runtime.createContext("a");
    const ctxB = await runtime.createContext("b");
    await ctxA.execute("var x = 5;");
    const result = await ctxB.execute("console.log(typeof x)");
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("undefined");
    await runtime.destroyContext("a");
    await runtime.destroyContext("b");
    await runtime.dispose();
  });

  it("transpiles TypeScript before execution", async () => {
    const runtime = new QuickJSRuntime();
    await runtime.initialize();
    const result = await runtime.execute(`
      const x: number = 5;
      console.log(x);
    `);
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("5");
    await runtime.dispose();
  });
});
