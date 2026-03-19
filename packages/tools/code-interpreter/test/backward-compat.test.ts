/**
 * Backward Compatibility Tests for @obsku/tool-code-interpreter
 *
 * These tests verify that the public API remains stable and that
 * existing usage patterns continue to work after auto-discovery changes.
 *
 * NOT tested here:
 * - Auto-discovery behavior (tested in separate auto-discovery tests)
 * - Full execution behavior (tested in integration.test.ts)
 */

import { describe, expect, test } from "bun:test";
import type { ParamDef } from "@obsku/framework";

// Test imports - these must work for backward compatibility
import {
  type CodeExecutor,
  type CodeInterpreterBackend,
  type CodeInterpreterOptions,
  codeInterpreter,
  createCodeInterpreter,
  createWorkspace,
  type ExecutionOptions,
  type ExecutionResult,
  LocalProcessExecutor,
  PathTraversalError,
  SessionManager,
  serializeExecutionResult,
} from "../src/index";

// Mock executor for bypassing auto-discovery
const createMockExecutor = (): CodeExecutor => ({
  name: "mock",
  supportedLanguages: ["python", "javascript", "typescript"],
  initialize: async () => {},
  execute: async (): Promise<ExecutionResult> => ({
    stdout: "mock output",
    stderr: "",
    success: true,
    executionTimeMs: 0,
  }),
  dispose: async () => {},
});

// Mock session manager for bypassing auto-discovery
const createMockSessionManager = () => ({
  execute: async (): Promise<ExecutionResult> => ({
    stdout: "mock session output",
    stderr: "",
    success: true,
    executionTimeMs: 0,
  }),
});

describe("code-interpreter backward compat: exports", () => {
  test("codeInterpreter is exported and is a plugin", () => {
    expect(codeInterpreter).toBeDefined();
    expect(codeInterpreter.name).toBe("code_interpreter");
    expect(codeInterpreter.description).toBeString();
    expect(typeof codeInterpreter.execute).toBe("function");
  });

  test("createCodeInterpreter is exported and callable", () => {
    expect(createCodeInterpreter).toBeDefined();
    expect(typeof createCodeInterpreter).toBe("function");

    // Should be able to call without options
    const plugin = createCodeInterpreter();
    expect(plugin.name).toBe("code_interpreter");
  });

  test("LocalProcessExecutor is exported", () => {
    expect(LocalProcessExecutor).toBeDefined();
    expect(typeof LocalProcessExecutor).toBe("function");
  });

  test("SessionManager is exported", () => {
    expect(SessionManager).toBeDefined();
    expect(typeof SessionManager).toBe("function");
  });

  test("createWorkspace is exported", () => {
    expect(createWorkspace).toBeDefined();
    expect(typeof createWorkspace).toBe("function");
  });

  test("PathTraversalError is exported", () => {
    expect(PathTraversalError).toBeDefined();
    expect(typeof PathTraversalError).toBe("function");
  });

  test("serializeExecutionResult is exported", () => {
    expect(serializeExecutionResult).toBeDefined();
    expect(typeof serializeExecutionResult).toBe("function");
  });

  test("CodeInterpreterOptions type is exported (compile-time check)", () => {
    const opts: CodeInterpreterOptions = {};
    expect(opts).toBeDefined();
  });

  test("CodeExecutor type is exported (compile-time check)", () => {
    const executor: CodeExecutor = createMockExecutor();
    expect(executor.name).toBe("mock");
  });

  test("ExecutionOptions type is exported (compile-time check)", () => {
    const opts: ExecutionOptions = {
      code: "print('hello')",
      language: "python",
    };
    expect(opts.code).toBe("print('hello')");
  });

  test("ExecutionResult type is exported (compile-time check)", () => {
    const result: ExecutionResult = {
      stdout: "",
      stderr: "",
      success: true,
      executionTimeMs: 0,
    };
    expect(result.success).toBe(true);
  });

  test("CodeInterpreterBackend type is exported (compile-time check)", () => {
    const backend: CodeInterpreterBackend = "local";
    expect(backend).toBe("local");
  });
});

describe("code-interpreter backward compat: plugin structure", () => {
  test("codeInterpreter.name === 'code_interpreter'", () => {
    expect(codeInterpreter.name).toBe("code_interpreter");
  });

  test("codeInterpreter has params schema with expected fields", () => {
    expect(codeInterpreter.params).toBeDefined();

    // Params is converted to Record<string, ParamDef> by the plugin function
    const params = codeInterpreter.params as Record<string, ParamDef>;

    // Verify all expected fields exist
    expect(params.code).toBeDefined();
    expect(params.language).toBeDefined();
    expect(params.sessionId).toBeDefined();
    expect(params.timeoutMs).toBeDefined();
    expect(params.inputFiles).toBeDefined();
  });

  test("codeInterpreter.params schema: code is required string", () => {
    const params = codeInterpreter.params as Record<string, ParamDef>;

    expect(params.code).toBeDefined();
    expect(params.code?.type).toBe("string");
    // code has no default (required)
    expect(params.code?.default).toBeUndefined();
  });

  test("codeInterpreter.params schema: language is required string", () => {
    const params = codeInterpreter.params as Record<string, ParamDef>;

    expect(params.language).toBeDefined();
    expect(params.language?.type).toBe("string");
    // language has no default (required)
    expect(params.language?.default).toBeUndefined();
  });

  test("codeInterpreter.params schema: sessionId is optional string", () => {
    const params = codeInterpreter.params as Record<string, ParamDef>;

    expect(params.sessionId).toBeDefined();
    expect(params.sessionId?.type).toBe("string");
  });

  test("codeInterpreter.params schema: timeoutMs is optional number", () => {
    const params = codeInterpreter.params as Record<string, ParamDef>;

    expect(params.timeoutMs).toBeDefined();
    expect(params.timeoutMs?.type).toBe("number");
  });

  test("codeInterpreter.params schema: inputFiles is optional object", () => {
    const params = codeInterpreter.params as Record<string, ParamDef>;

    expect(params.inputFiles).toBeDefined();
    expect(params.inputFiles?.type).toBe("object");
  });
});

describe("code-interpreter backward compat: createCodeInterpreter bypass auto-discovery", () => {
  test("createCodeInterpreter({ executor: mockExecutor }) uses provided executor", () => {
    const mockExecutor = createMockExecutor();
    const plugin = createCodeInterpreter({ executor: mockExecutor });

    expect(plugin.name).toBe("code_interpreter");
    // The plugin should be created successfully with the mock executor
    expect(plugin.params).toBeDefined();
  });

  test("createCodeInterpreter({ executor, sessionManager }) bypasses auto-discovery", () => {
    const mockExecutor = createMockExecutor();
    const mockSM = createMockSessionManager();

    const plugin = createCodeInterpreter({
      executor: mockExecutor,
      sessionManager: mockSM as any,
    });

    expect(plugin.name).toBe("code_interpreter");
    expect(plugin.params).toBeDefined();
  });

  test("createCodeInterpreter with backend option works", () => {
    // backend option should be accepted (auto-discovery path)
    const plugin = createCodeInterpreter({ backend: "local" });
    expect(plugin.name).toBe("code_interpreter");
  });

  test("createCodeInterpreter with envFilter option works", () => {
    const plugin = createCodeInterpreter({
      envFilter: { mode: "blocklist", patterns: ["AWS_*"] },
    });
    expect(plugin.name).toBe("code_interpreter");
  });
});

describe("code-interpreter backward compat: LocalProcessExecutor", () => {
  test("LocalProcessExecutor can be instantiated", () => {
    const executor = new LocalProcessExecutor();
    expect(executor).toBeDefined();
    expect(executor.name).toBe("local-process");
    expect(executor.supportedLanguages).toContain("python");
    expect(executor.supportedLanguages).toContain("javascript");
    expect(executor.supportedLanguages).toContain("typescript");
  });
});

describe("code-interpreter backward compat: SessionManager", () => {
  test("SessionManager can be instantiated", () => {
    const sm = new SessionManager();
    expect(sm).toBeDefined();
    expect(typeof sm.execute).toBe("function");
  });

  test("SessionManager accepts envFilter option", () => {
    const sm = new SessionManager({
      envFilter: { mode: "blocklist", patterns: ["SECRET_*"] },
    });
    expect(sm).toBeDefined();
  });
});

describe("code-interpreter backward compat: serializeExecutionResult", () => {
  test("serializeExecutionResult returns JSON string for success result", () => {
    const result: ExecutionResult = {
      stdout: "output",
      stderr: "",
      success: true,
      executionTimeMs: 100,
    };

    const serialized = serializeExecutionResult(result);
    expect(typeof serialized).toBe("string");

    // Should be valid JSON
    const parsed = JSON.parse(serialized);
    expect(parsed.stdout).toBe("output");
    expect(parsed.success).toBe(true);
    expect(parsed.executionTimeMs).toBe(100);
  });

  test("serializeExecutionResult returns JSON string for error result", () => {
    const result: ExecutionResult = {
      stdout: "",
      stderr: "error occurred",
      success: false,
      executionTimeMs: 50,
    };

    const serialized = serializeExecutionResult(result);
    expect(typeof serialized).toBe("string");

    const parsed = JSON.parse(serialized);
    expect(parsed.stderr).toBe("error occurred");
    expect(parsed.success).toBe(false);
  });
});

describe("code-interpreter backward compat: workspace", () => {
  test("createWorkspace creates workspace context with dir property", async () => {
    const workspace = await createWorkspace();
    expect(workspace).toBeDefined();
    expect(workspace.dir).toBeDefined();
    expect(typeof workspace.dir).toBe("string");

    // Cleanup the temp directory
    await workspace.cleanup();
  });

  test("createWorkspace returns workspace with expected methods", async () => {
    const workspace = await createWorkspace();
    expect(typeof workspace.cleanup).toBe("function");
    expect(typeof workspace.stageFile).toBe("function");
    expect(typeof workspace.collectOutputFiles).toBe("function");

    // Cleanup
    await workspace.cleanup();
  });

  test("PathTraversalError is throwable", () => {
    expect(() => {
      throw new PathTraversalError("/etc/passwd", "/workspace");
    }).toThrow(PathTraversalError);
  });
});
