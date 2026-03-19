import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createWasmCodeInterpreter, type ExecutionResult } from "../src/index";

type PluginResult = { isError?: boolean; result: string };

async function runPlugin(
  plugin: ReturnType<typeof createWasmCodeInterpreter>,
  input: Record<string, unknown>
): Promise<PluginResult> {
  return Effect.runPromise(plugin.execute(input)) as Promise<PluginResult>;
}

describe("Wasm code interpreter plugin integration", () => {
  test("javascript roundtrip via plugin", async () => {
    const output = await runPlugin(createWasmCodeInterpreter(), {
      code: `console.log("wasm-js")`,
      language: "javascript",
    });

    expect(output.isError).toBe(false);
    const parsed = JSON.parse(output.result) as ExecutionResult;
    expect(parsed.success).toBe(true);
    expect(parsed.stdout.trim()).toBe("wasm-js");
    expect(typeof parsed.executionTimeMs).toBe("number");
  });

  test("typescript roundtrip via plugin", async () => {
    const output = await runPlugin(createWasmCodeInterpreter(), {
      code: `const msg: string = "wasm-ts"; console.log(msg);`,
      language: "typescript",
    });

    expect(output.isError).toBe(false);
    const parsed = JSON.parse(output.result) as ExecutionResult;
    expect(parsed.success).toBe(true);
    expect(parsed.stdout.trim()).toBe("wasm-ts");
  });
});
