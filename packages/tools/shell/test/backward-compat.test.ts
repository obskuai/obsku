/**
 * Backward Compatibility Tests for @obsku/tool-shell
 *
 * These tests verify that the public API remains stable and that
 * existing usage patterns continue to work after auto-discovery changes.
 *
 * NOT tested here:
 * - Auto-discovery behavior (tested in separate auto-discovery tests)
 * - Full execution behavior (tested in exec.test.ts)
 */

import { describe, expect, test } from "bun:test";
import type { ParamDef } from "@obsku/framework";
import type { ShellBackend } from "../src/index";
// Test imports - these must work for backward compatibility
import { type CreateExecOptions, createExec, exec } from "../src/index";

describe("shell backward compat: exports", () => {
  test("exec is exported and is a plugin", () => {
    expect(exec).toBeDefined();
    expect(exec.name).toBe("exec");
    expect(exec.description).toBeString();
    expect(typeof exec.execute).toBe("function");
  });

  test("createExec is exported and callable", () => {
    expect(createExec).toBeDefined();
    expect(typeof createExec).toBe("function");

    // Should be able to call without options
    const plugin = createExec();
    expect(plugin.name).toBe("exec");
  });

  test("CreateExecOptions type is exported (compile-time check)", () => {
    // This is a type-only test - if it compiles, the type is exported
    const opts: CreateExecOptions = {};
    expect(opts).toBeDefined();
  });

  test("ShellBackend type is exported (compile-time check)", () => {
    // This is a type-only test - if it compiles, the type is exported
    // ShellBackend is a union: "local" | "sandbox" | ShellBackendConfig
    type TestBackend = ShellBackend;
    const backend: TestBackend = "local";
    expect(backend).toBe("local");
  });
});

describe("shell backward compat: exec plugin structure", () => {
  test("exec.name === 'exec'", () => {
    expect(exec.name).toBe("exec");
  });

  test("exec has params schema with expected fields", () => {
    expect(exec.params).toBeDefined();

    // Params is converted to Record<string, ParamDef> by the plugin function
    const params = exec.params as Record<string, ParamDef>;

    // Verify all expected fields exist
    expect(params.command).toBeDefined();
    expect(params.args).toBeDefined();
    expect(params.cwd).toBeDefined();
    expect(params.env).toBeDefined();
    expect(params.shell).toBeDefined();
    expect(params.timeout).toBeDefined();
  });

  test("exec.params schema: command is required string", () => {
    const params = exec.params as Record<string, ParamDef>;

    expect(params.command).toBeDefined();
    expect(params.command?.type).toBe("string");
    // command has no default (required)
    expect(params.command?.default).toBeUndefined();
  });

  test("exec.params schema: args is array type", () => {
    const params = exec.params as Record<string, ParamDef>;

    expect(params.args).toBeDefined();
    expect(params.args?.type).toBe("array");
    // args has a default (empty array)
    expect(params.args?.default).toEqual([]);
  });

  test("exec.params schema: cwd is optional string", () => {
    const params = exec.params as Record<string, ParamDef>;

    expect(params.cwd).toBeDefined();
    expect(params.cwd?.type).toBe("string");
  });

  test("exec.params schema: env is object type", () => {
    const params = exec.params as Record<string, ParamDef>;

    expect(params.env).toBeDefined();
    expect(params.env?.type).toBe("object");
  });

  test("exec.params schema: shell is boolean with default false", () => {
    const params = exec.params as Record<string, ParamDef>;

    expect(params.shell).toBeDefined();
    expect(params.shell?.type).toBe("boolean");
    expect(params.shell?.default).toBe(false);
  });

  test("exec.params schema: timeout is number with default 30000", () => {
    const params = exec.params as Record<string, ParamDef>;

    expect(params.timeout).toBeDefined();
    expect(params.timeout?.type).toBe("number");
    expect(params.timeout?.default).toBe(30000);
  });
});

describe("shell backward compat: createExec options", () => {
  test("createExec() without options creates default plugin", () => {
    const plugin = createExec();
    expect(plugin.name).toBe("exec");
    expect(plugin.params).toBeDefined();
  });

  test("createExec accepts backend option", () => {
    const opts: CreateExecOptions = { backend: "local" };
    const plugin = createExec(opts);
    expect(plugin.name).toBe("exec");
  });

  test("createExec accepts fs option", () => {
    const opts: CreateExecOptions = { fs: "memory" };
    const plugin = createExec(opts);
    expect(plugin.name).toBe("exec");
  });

  test("createExec accepts network option", () => {
    const opts: CreateExecOptions = {
      network: { enabled: false },
    };
    const plugin = createExec(opts);
    expect(plugin.name).toBe("exec");
  });

  test("createExec accepts envFilter option", () => {
    const opts: CreateExecOptions = {
      envFilter: { mode: "blocklist", patterns: ["AWS_*"] },
    };
    const plugin = createExec(opts);
    expect(plugin.name).toBe("exec");
  });
});

describe("shell backward compat: local backend (no sandbox)", () => {
  // When sandbox is not installed, exec should work with local backend
  // This is the default backward-compatible behavior

  test("exec works without any configuration", () => {
    // Just verify the plugin structure exists and is usable
    expect(exec.name).toBe("exec");
    expect(typeof exec.execute).toBe("function");
  });

  test("createExec with backend: 'local' works", () => {
    const plugin = createExec({ backend: "local" });
    expect(plugin.name).toBe("exec");
    expect(plugin.description).toBeString();
  });
});
