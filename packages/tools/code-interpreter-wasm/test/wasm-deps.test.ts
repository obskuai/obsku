import { describe, expect, it } from "bun:test";

describe("WASM Dependencies", () => {
  it("pyodide loads successfully", async () => {
    const { loadPyodide } = await import("pyodide");
    const pyodide = await loadPyodide();
    expect(pyodide).toBeDefined();
    expect(typeof pyodide.runPython).toBe("function");
  });

  it("quickjs-emscripten loads successfully", async () => {
    const { getQuickJS } = await import("quickjs-emscripten");
    const QuickJS = await getQuickJS();
    expect(QuickJS).toBeDefined();
    expect(typeof QuickJS.newContext).toBe("function");
  });
});
