import { afterEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { createCodeInterpreter, type SessionManager } from "../src/index";
import type { ResolvedCodeExecutor } from "../src/resolve-executor";
import type { CodeExecutor, ExecutionResult } from "../src/types";

const originalRegion = process.env.AWS_REGION;

type PluginResult = { isError?: boolean; result: string };

async function runPlugin(
  p: { execute: (input: Record<string, unknown>) => Effect.Effect<unknown> },
  input: Record<string, unknown>
): Promise<PluginResult> {
  return Effect.runPromise(p.execute(input)) as Promise<PluginResult>;
}

function createFakeExecutor(
  name: string,
  stdout: string,
  execution?: {
    initialize?: () => Promise<void>;
    execute?: () => Promise<ExecutionResult>;
  }
): CodeExecutor {
  return {
    name,
    supportedLanguages: ["python", "javascript", "typescript"],
    initialize: execution?.initialize ?? mock(async () => {}),
    execute:
      execution?.execute ??
      mock(
        async (): Promise<ExecutionResult> => ({
          stdout,
          stderr: "",
          success: true,
          executionTimeMs: 10,
        })
      ),
    dispose: mock(async () => {}),
  };
}

function createResolved(
  backend: ResolvedCodeExecutor["backend"],
  executor: CodeExecutor,
  sessionExecute?: () => Promise<ExecutionResult>
): ResolvedCodeExecutor {
  return {
    backend,
    executor,
    sessionManager: {
      execute:
        sessionExecute ??
        (async () => ({ stdout: "", stderr: "", success: true, executionTimeMs: 0 })),
    } as SessionManager,
  };
}

describe("createCodeInterpreter auto-discovery", () => {
  afterEach(() => {
    if (originalRegion === undefined) {
      delete process.env.AWS_REGION;
    } else {
      process.env.AWS_REGION = originalRegion;
    }
    mock.restore();
  });

  describe("createCodeInterpreter() with auto-discovery", () => {
    test("creates plugin with lazy executor (auto local fallback)", async () => {
      const plugin = createCodeInterpreter();

      expect(plugin).toBeDefined();
      expect(plugin.name).toBe("code_interpreter");
    });

    test("lazy executor resolves backend on first execute call", async () => {
      const fakeResolved = createResolved("wasm", createFakeExecutor("wasm", "wasm output"));
      const resolveExecutor = mock(async () => fakeResolved);

      const plugin = createCodeInterpreter({ resolveExecutor });
      const result = await runPlugin(plugin, {
        code: 'print("hello")',
        language: "python",
      });

      expect(resolveExecutor).toHaveBeenCalledTimes(1);
      expect(result.isError).toBeFalsy();
      expect(result.result).toContain("wasm output");
    });

    test("auto-discovery uses agentcore when AWS_REGION set", async () => {
      process.env.AWS_REGION = "us-east-1";

      const fakeResolved = createResolved(
        "agentcore",
        createFakeExecutor("agentcore", "agentcore output", {
          execute: mock(
            async (): Promise<ExecutionResult> => ({
              stdout: "agentcore output",
              stderr: "",
              success: true,
              executionTimeMs: 5,
            })
          ),
        })
      );
      const resolveExecutor = mock(async () => fakeResolved);

      const plugin = createCodeInterpreter({ resolveExecutor });
      const result = await runPlugin(plugin, {
        code: 'print("hello")',
        language: "python",
      });

      expect(resolveExecutor).toHaveBeenCalledTimes(1);
      expect(result.isError).toBeFalsy();
      expect(result.result).toContain("agentcore output");
    });
  });

  describe("createCodeInterpreter({ backend: 'wasm' }) explicit", () => {
    test("creates plugin with explicit wasm backend", async () => {
      const fakeResolved = createResolved("wasm", createFakeExecutor("wasm", "explicit wasm"));
      const resolveExecutor = mock(async (backend?: ResolvedCodeExecutor["backend"]) => {
        expect(backend).toBe("wasm");
        return fakeResolved;
      });

      const plugin = createCodeInterpreter({ backend: "wasm", resolveExecutor });

      expect(plugin).toBeDefined();
      expect(plugin.name).toBe("code_interpreter");

      const result = await runPlugin(plugin, {
        code: "test",
        language: "javascript",
      });

      expect(result.isError).toBeFalsy();
      expect(result.result).toContain("explicit wasm");
    });

  });

  describe("createCodeInterpreter({ executor: mock }) bypass", () => {
    test("uses explicit executor without auto-discovery", async () => {
      const mockExecutor: CodeExecutor = createFakeExecutor("mock-test", "mock executor result");

      const plugin = createCodeInterpreter({ executor: mockExecutor });

      expect(plugin).toBeDefined();

      const result = await runPlugin(plugin, {
        code: "any code",
        language: "javascript",
      });

      expect(result.isError).toBeFalsy();
      expect(result.result).toContain("mock executor result");
      expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
    });

    test("explicit executor bypasses resolveCodeExecutor entirely", async () => {
      const resolveExecutor = mock(async () => {
        throw new Error("should not run");
      });
      const mockExecutor: CodeExecutor = createFakeExecutor("bypass-mock", "bypassed");

      const plugin = createCodeInterpreter({ executor: mockExecutor, resolveExecutor });

      await runPlugin(plugin, { code: "test", language: "python" });

      expect(resolveExecutor).toHaveBeenCalledTimes(0);
    });
  });

  describe("lazy resolution behavior", () => {
    test("executor.initialize() called before execute()", async () => {
      const initOrder: string[] = [];
      const mockExecutor: CodeExecutor = createFakeExecutor("init-order-test", "done", {
        initialize: mock(async () => {
          initOrder.push("initialize");
        }),
        execute: mock(async (): Promise<ExecutionResult> => {
          initOrder.push("execute");
          return {
            stdout: "done",
            stderr: "",
            success: true,
            executionTimeMs: 0,
          };
        }),
      });

      const plugin = createCodeInterpreter({
        resolveExecutor: async () => createResolved("local", mockExecutor),
      });

      await runPlugin(plugin, { code: "test", language: "python" });

      expect(initOrder).toEqual(["initialize", "execute"]);
    });

    test("resolution happens only once (cached)", async () => {
      let resolveCount = 0;
      const mockExecutor: CodeExecutor = createFakeExecutor("cache-test", "cached", {
        execute: mock(
          async (): Promise<ExecutionResult> => ({
            stdout: "cached",
            stderr: "",
            success: true,
            executionTimeMs: 0,
          })
        ),
      });
      const fakeResolved = createResolved("local", mockExecutor);
      const resolveExecutor = mock(async () => {
        resolveCount++;
        return fakeResolved;
      });

      const plugin = createCodeInterpreter({ resolveExecutor });

      await runPlugin(plugin, { code: "first", language: "python" });
      await runPlugin(plugin, { code: "second", language: "python" });
      await runPlugin(plugin, { code: "third", language: "python" });

      expect(resolveCount).toBe(1);
    });

    describe("session management", () => {
      test("sessionManager execute called when sessionId provided", async () => {
        const mockExecutor: CodeExecutor = createFakeExecutor("session-test", "executor output");
        const mockSessionExecute = mock(
          async (): Promise<ExecutionResult> => ({
            stdout: "session output",
            stderr: "",
            success: true,
            executionTimeMs: 0,
          })
        );

        const plugin = createCodeInterpreter({
          resolveExecutor: async () =>
            createResolved("local", mockExecutor, async () => mockSessionExecute()),
        });

        const result = await runPlugin(plugin, {
          code: "session code",
          language: "python",
          sessionId: "test-session-123",
        });

        expect(mockSessionExecute).toHaveBeenCalledTimes(1);
        expect(result.result).toContain("session output");
      });
    });
  });

  describe("codeInterpreter default export", () => {
    test("is a valid plugin with auto-discovery", async () => {
      const { codeInterpreter } = await import("../src/index");

      expect(codeInterpreter).toBeDefined();
      expect(codeInterpreter.name).toBe("code_interpreter");
      expect(codeInterpreter.params).toBeDefined();
    });
  });
});
