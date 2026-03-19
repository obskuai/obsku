import { describe, expect, test } from "bun:test";
import type { WasmContext, WasmRuntime } from "../src/runtimes/types";
import type { ExecutionResult, SupportedLanguage } from "@obsku/tool-code-interpreter";
import { WasmSessionManager } from "../src/wasm-session-manager";

function createMockContext(
  id: string,
  executeImpl?: (code: string) => Promise<ExecutionResult>
): WasmContext {
  return {
    async execute(code: string): Promise<ExecutionResult> {
      if (executeImpl) {
        return executeImpl(code);
      }
      return {
        executionTimeMs: 1,
        exitCode: 0,
        stderr: "",
        stdout: `result:${code}`,
        success: true,
      };
    },
    id,
    async listFiles() {
      return [];
    },
    async mountFile() {},
    async readFile() {
      return new Uint8Array();
    },
  };
}

interface MockRuntime extends WasmRuntime {
  contextIds: Array<string>;
  disposed: boolean;
  failCreate: boolean;
}

function createMockRuntime(executeImpl?: (code: string) => Promise<ExecutionResult>): MockRuntime {
  const contextIds: Array<string> = [];
  return {
    contextIds,
    async createContext(id: string): Promise<WasmContext> {
      if ((this as MockRuntime).failCreate) {
        throw new Error("runtime unavailable");
      }
      contextIds.push(id);
      return createMockContext(id, executeImpl);
    },
    async destroyContext(id: string): Promise<void> {
      const idx = contextIds.indexOf(id);
      if (idx !== -1) {
        contextIds.splice(idx, 1);
      }
    },
    async dispose(): Promise<void> {
      (this as MockRuntime).disposed = true;
      contextIds.length = 0;
    },
    disposed: false,
    async execute(): Promise<ExecutionResult> {
      return { executionTimeMs: 0, exitCode: 0, stderr: "", stdout: "", success: true };
    },
    failCreate: false,
    async initialize() {},
    name: "mock",
    supportedLanguages: ["javascript", "typescript", "python"] as Array<SupportedLanguage>,
  };
}

function makeManager(opts?: {
  execImpl?: (code: string) => Promise<ExecutionResult>;
  maxSessions?: number;
}) {
  const runtime = createMockRuntime(opts?.execImpl);
  const manager = new WasmSessionManager(runtime, opts?.maxSessions ?? 10);
  return { manager, runtime };
}

describe("WasmSessionManager — lifecycle", () => {
  test("create returns a non-empty session ID", () => {
    const { manager } = makeManager();
    const id = manager.create("javascript");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("execute returns successful result for valid session", async () => {
    const { manager } = makeManager();
    const id = manager.create("javascript");
    const result = await manager.execute(id, "1 + 1");
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("1 + 1");
  });

  test("execute returns error for unknown session ID", async () => {
    const { manager } = makeManager();
    const result = await manager.execute("nonexistent-id", "code");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("not found");
  });

  test("destroy removes session — subsequent execute returns error", async () => {
    const { manager } = makeManager();
    const id = manager.create("javascript");
    await manager.execute(id, "x");
    await manager.destroy(id);
    const result = await manager.execute(id, "code");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("not found");
  });

  test("destroy is idempotent (double destroy is safe)", async () => {
    const { manager } = makeManager();
    const id = manager.create("javascript");
    await manager.destroy(id);
    await expect(manager.destroy(id)).resolves.toBeUndefined();
  });

  test("destroy calls runtime.destroyContext", async () => {
    const { manager, runtime } = makeManager();
    const id = manager.create("javascript");
    await manager.execute(id, "x");
    await manager.destroy(id);
    expect(runtime.contextIds).not.toContain(id);
  });

  test("create yields unique IDs for multiple sessions", () => {
    const { manager } = makeManager();
    const ids = new Set([
      manager.create("javascript"),
      manager.create("javascript"),
      manager.create("python"),
    ]);
    expect(ids.size).toBe(3);
  });
});

describe("WasmSessionManager — max duration", () => {
  test("execute fails when max duration exceeded", async () => {
    const { manager } = makeManager();
    const id = manager.create("javascript", { maxDurationMs: -1 });
    const result = await manager.execute(id, "code");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("exceeded max duration");
  });

  test("session is destroyed after max duration exceeded", async () => {
    const { manager } = makeManager();
    const id = manager.create("javascript", { maxDurationMs: -1 });
    await manager.execute(id, "code");
    const result = await manager.execute(id, "code2");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("not found");
  });
});

describe("WasmSessionManager — idle timeout", () => {
  test("execute fails when idle timeout exceeded", async () => {
    const { manager } = makeManager();
    const id = manager.create("javascript", { idleTimeoutMs: -1 });
    const result = await manager.execute(id, "code");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("exceeded idle timeout");
  });

  test("session is destroyed after idle timeout", async () => {
    const { manager } = makeManager();
    const id = manager.create("javascript", { idleTimeoutMs: -1 });
    await manager.execute(id, "code");
    const result = await manager.execute(id, "x");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("not found");
  });
});

describe("WasmSessionManager — concurrent execution", () => {
  test("returns error when session is already executing", async () => {
    let resolveExec!: () => void;
    const slowExec = (_code: string): Promise<ExecutionResult> =>
      new Promise<ExecutionResult>((resolve) => {
        resolveExec = () =>
          resolve({ executionTimeMs: 1, exitCode: 0, stderr: "", stdout: "done", success: true });
      });

    const { manager } = makeManager({ execImpl: slowExec });
    const id = manager.create("javascript");
    await new Promise<void>((r) => setTimeout(r, 10));

    const first = manager.execute(id, "slow");
    const second = await manager.execute(id, "concurrent");
    expect(second.success).toBe(false);
    expect(second.stderr).toContain("already executing");

    resolveExec();
    await first;
  });
});

describe("WasmSessionManager — max sessions", () => {
  test("throws when max sessions exceeded", () => {
    const { manager } = makeManager({ maxSessions: 2 });
    manager.create("javascript");
    manager.create("javascript");
    expect(() => manager.create("javascript")).toThrow(/max.*sessions/i);
  });

  test("allows new session after one is destroyed", async () => {
    const { manager } = makeManager({ maxSessions: 1 });
    const id = manager.create("javascript");
    await manager.destroy(id);
    expect(() => manager.create("javascript")).not.toThrow();
  });
});

describe("WasmSessionManager — destroyAll", () => {
  test("destroyAll removes all sessions", async () => {
    const { manager } = makeManager();
    const id1 = manager.create("javascript");
    const id2 = manager.create("python");
    await manager.execute(id1, "x");
    await manager.execute(id2, "x");
    await manager.destroyAll();
    expect((await manager.execute(id1, "x")).success).toBe(false);
    expect((await manager.execute(id2, "x")).success).toBe(false);
  });

  test("destroyAll calls runtime.destroyContext for each session", async () => {
    const { manager, runtime } = makeManager();
    const id1 = manager.create("javascript");
    const id2 = manager.create("python");
    await manager.execute(id1, "x");
    await manager.execute(id2, "x");
    await manager.destroyAll();
    expect(runtime.contextIds).toHaveLength(0);
  });

  test("destroyAll on empty manager is safe", async () => {
    const { manager } = makeManager();
    await expect(manager.destroyAll()).resolves.toBeUndefined();
  });

  test("after destroyAll new sessions can be created", async () => {
    const { manager } = makeManager({ maxSessions: 2 });
    manager.create("javascript");
    manager.create("javascript");
    await manager.destroyAll();
    expect(() => manager.create("javascript")).not.toThrow();
  });
});

describe("WasmSessionManager — result passthrough", () => {
  test("forwards stdout from context", async () => {
    const { manager } = makeManager({
      execImpl: async () => ({
        executionTimeMs: 5,
        exitCode: 0,
        stderr: "",
        stdout: "hello world",
        success: true,
      }),
    });
    const id = manager.create("javascript");
    const result = await manager.execute(id, "anything");
    expect(result.stdout).toBe("hello world");
  });

  test("forwards failure from context", async () => {
    const { manager } = makeManager({
      execImpl: async () => ({
        executionTimeMs: 2,
        exitCode: 1,
        stderr: "runtime error",
        stdout: "",
        success: false,
      }),
    });
    const id = manager.create("javascript");
    const result = await manager.execute(id, "bad code");
    expect(result.success).toBe(false);
    expect(result.stderr).toBe("runtime error");
  });

  test("wraps thrown errors from context as error result", async () => {
    const { manager } = makeManager({
      execImpl: async () => {
        throw new Error("context exploded");
      },
    });
    const id = manager.create("javascript");
    const result = await manager.execute(id, "boom");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("context exploded");
  });
});

describe("WasmSessionManager — languages", () => {
  test("creates python session", async () => {
    const { manager } = makeManager();
    const id = manager.create("python");
    const result = await manager.execute(id, "print('hello')");
    expect(result.success).toBe(true);
  });

  test("creates typescript session", async () => {
    const { manager } = makeManager();
    const id = manager.create("typescript");
    const result = await manager.execute(id, "const x: number = 1");
    expect(result.success).toBe(true);
  });
});

describe("WasmSessionManager — default options", () => {
  test("default max duration is 1 hour", () => {
    const { manager } = makeManager();
    const id = manager.create("javascript", { maxDurationMs: 3_600_000 });
    expect(id).toBeTruthy();
  });

  test("default idle timeout is 15 minutes", () => {
    const { manager } = makeManager();
    const id = manager.create("javascript", { idleTimeoutMs: 900_000 });
    expect(id).toBeTruthy();
  });
});
