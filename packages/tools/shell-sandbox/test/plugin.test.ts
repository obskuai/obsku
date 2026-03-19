import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { createSandboxedExec, sandboxedExec } from "../src/plugin";

function runEffect<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromiseExit(effect);
}

function extractSuccess(exit: Exit.Exit<unknown, unknown>): unknown {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw new Error(`Expected success, got failure: ${JSON.stringify(exit.cause)}`);
}

interface PluginExecutionResult {
  isError?: boolean;
  result: string;
}

describe("sandboxed_exec plugin", () => {
  test("has correct metadata", () => {
    expect(sandboxedExec.name).toBe("sandboxed_exec");
    expect(sandboxedExec.description).toBeString();
    expect(sandboxedExec.description.length).toBeGreaterThan(0);
    expect(typeof sandboxedExec.execute).toBe("function");
  });

  test("plugin has description", () => {
    expect(sandboxedExec.description).toBeString();
    expect(sandboxedExec.description.length).toBeGreaterThan(0);
  });

  test("plugin has execute function", () => {
    expect(typeof sandboxedExec.execute).toBe("function");
  });

  test("plugin execution - basic echo command", async () => {
    const exit = await runEffect(sandboxedExec.execute({ command: "echo test" }));
    const wrappedResult = extractSuccess(exit) as PluginExecutionResult;
    const result = JSON.parse(wrappedResult.result) as {
      exitCode: number;
      stderr: string;
      stdout: string;
      timedOut: boolean;
    };

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("test\n");
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
  });

  test("createSandboxedExec creates custom plugin", () => {
    const customPlugin = createSandboxedExec({ fs: "memory", timeout: 5000 });
    expect(customPlugin.name).toBe("sandboxed_exec");
    expect(typeof customPlugin.execute).toBe("function");
  });

  test("error-review directive matches non-zero exit", () => {
    const directive = sandboxedExec.directives![0];
    expect(directive.name).toBe("error-review");

    const matchesError = directive.match(
      JSON.stringify({ exitCode: 1, stderr: "fail", stdout: "", timedOut: false }),
      {}
    );
    expect(matchesError).toBe(true);
  });

  test("error-review directive does not match zero exit", () => {
    const directive = sandboxedExec.directives![0];
    const matchesSuccess = directive.match(
      JSON.stringify({ exitCode: 0, stderr: "", stdout: "ok", timedOut: false }),
      {}
    );
    expect(matchesSuccess).toBe(false);
  });

  test("error-review directive handles invalid JSON", () => {
    const directive = sandboxedExec.directives![0];
    const matchesBadJson = directive.match("not json at all", {});
    expect(matchesBadJson).toBe(false);
  });

  test("error-review directive injects guidance string", () => {
    const directive = sandboxedExec.directives![0];
    expect(typeof directive.inject).toBe("string");
    expect((directive.inject as string).length).toBeGreaterThan(0);
  });

  test("network-enabled plugin has different description", () => {
    const networkPlugin = createSandboxedExec({
      fs: "memory",
      network: { enabled: true, allowedUrlPrefixes: ["https://api.example.com/"] },
    });
    expect(networkPlugin.description).toContain("restricted network");
  });
});
