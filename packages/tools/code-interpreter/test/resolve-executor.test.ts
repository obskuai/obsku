import { afterEach, describe, expect, mock, test } from "bun:test";
import { resolveCodeExecutor } from "../src/resolve-executor";
import type { CodeExecutor, ExecutionResult } from "../src/types";

const originalRegion = process.env.AWS_REGION;

function createFakeExecutor(name: string): CodeExecutor {
  return {
    name,
    supportedLanguages: ["python", "javascript", "typescript"],
    initialize: mock(async () => {}),
    execute: mock(
      async (): Promise<ExecutionResult> => ({
        stdout: "",
        stderr: "",
        success: true,
        executionTimeMs: 0,
      })
    ),
    dispose: mock(async () => {}),
  };
}

function createAgentcoreModule() {
  const executor = createFakeExecutor("agentcore");
  return {
    AgentCoreExecutor: class MockAgentCoreExecutor {
      name = executor.name;
      supportedLanguages = executor.supportedLanguages;
      initialize = executor.initialize;
      execute = executor.execute;
      dispose = executor.dispose;
    },
    AgentCoreSessionManager: class MockAgentCoreSessionManager {
      execute = mock(
        async (): Promise<ExecutionResult> => ({
          stdout: "",
          stderr: "",
          success: true,
          executionTimeMs: 0,
        })
      );
    },
    BedrockAgentCoreClient: class MockBedrockAgentCoreClient {
      constructor(_opts: { region: string }) {}
    },
  };
}

function createWasmModule() {
  const executor = createFakeExecutor("wasm");
  return {
    WasmExecutor: class MockWasmExecutor {
      name = executor.name;
      supportedLanguages = executor.supportedLanguages;
      initialize = executor.initialize;
      execute = executor.execute;
      dispose = executor.dispose;
    },
  };
}

describe("resolveCodeExecutor", () => {
  afterEach(() => {
    if (originalRegion === undefined) {
      delete process.env.AWS_REGION;
    } else {
      process.env.AWS_REGION = originalRegion;
    }
    mock.restore();
  });

  describe("explicit backend selection", () => {
    test("explicit backend=local always works", async () => {
      const result = await resolveCodeExecutor("local");

      expect(result.backend).toBe("local");
      expect(result.executor.name).toBe("local-process");
    });

    test("explicit backend=agentcore throws when AWS_REGION missing", async () => {
      delete process.env.AWS_REGION;

      await expect(resolveCodeExecutor("agentcore")).rejects.toThrow("requires region");
    });

    test("explicit backend=agentcore works when AWS_REGION set", async () => {
      process.env.AWS_REGION = "ap-southeast-1";

      const result = await resolveCodeExecutor("agentcore", undefined, {
        loadAgentcoreModule: async () => createAgentcoreModule(),
      });

      expect(result.backend).toBe("agentcore");
    });

    test("explicit backend=wasm uses wasm when installed", async () => {
      const result = await resolveCodeExecutor("wasm", undefined, {
        loadWasmModule: async () => createWasmModule(),
      });

      expect(result.backend).toBe("wasm");
    });

    test("explicit backend throws when not installed", async () => {
      await expect(
        resolveCodeExecutor("wasm", undefined, {
          loadWasmModule: async () => {
            throw new Error("missing wasm");
          },
        })
      ).rejects.toThrow();
    });
  });

  describe("agentcore skip when AWS_REGION missing", () => {
    test("skips agentcore and falls through when AWS_REGION not set", async () => {
      delete process.env.AWS_REGION;

      const result = await resolveCodeExecutor(undefined, undefined, {
        loadAgentcoreModule: async () => createAgentcoreModule(),
        loadWasmModule: async () => createWasmModule(),
        getRegion: () => undefined,
      });

      expect(result.backend).toBe("wasm");
    });

    test("uses agentcoreOpts.region when AWS_REGION not set", async () => {
      delete process.env.AWS_REGION;

      const result = await resolveCodeExecutor(
        undefined,
        { region: "eu-west-1" },
        {
          loadAgentcoreModule: async () => createAgentcoreModule(),
          getRegion: () => undefined,
        }
      );

      expect(result.backend).toBe("agentcore");
    });
  });

  describe("ResolvedCodeExecutor structure", () => {
    test("returns backend, executor, and sessionManager", async () => {
      const result = await resolveCodeExecutor("local");

      expect(result).toHaveProperty("backend");
      expect(result).toHaveProperty("executor");
      expect(result).toHaveProperty("sessionManager");
      expect(typeof result.backend).toBe("string");
      expect(result.executor).toBeDefined();
      expect(result.sessionManager).toBeDefined();
    });

    test("executor has required CodeExecutor interface", async () => {
      const result = await resolveCodeExecutor("local");
      const executor = result.executor as CodeExecutor;

      expect(executor.name).toBeDefined();
      expect(executor.supportedLanguages).toBeDefined();
      expect(typeof executor.initialize).toBe("function");
      expect(typeof executor.execute).toBe("function");
      expect(typeof executor.dispose).toBe("function");
    });
  });
});
