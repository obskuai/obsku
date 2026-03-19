import { describe, expect, mock, test } from "bun:test";
import {
  loadSandboxExecutor,
  resolveShellBackend,
  type SandboxModule,
} from "../src/resolve-backend";

function createFakeSandboxModule(): SandboxModule {
  return {
    SandboxedShellExecutor: class {
      async execute() {
        return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
      }

      async dispose() {}
    },
    createSandboxedExec: mock(() => ({})),
    sandboxedExec: {},
  };
}

describe("resolve-backend", () => {
  describe("resolveShellBackend", () => {
    describe("explicit local", () => {
      test("explicit 'local' always returns 'local' without importing sandbox", async () => {
        const loadSandboxModule = mock(async () => createFakeSandboxModule());

        const result = await resolveShellBackend("local", { loadSandboxModule });

        expect(result).toBe("local");
        expect(loadSandboxModule).not.toHaveBeenCalled();
      });
    });

    describe("sandbox via injected loader", () => {
      test("auto-discovery returns 'sandbox' when available", async () => {
        const loadSandboxModule = mock(async () => createFakeSandboxModule());

        const result = await resolveShellBackend(undefined, { loadSandboxModule });

        expect(result).toBe("sandbox");
        expect(loadSandboxModule).toHaveBeenCalledTimes(1);
      });

      test("explicit 'sandbox' returns 'sandbox' when installed", async () => {
        const loadSandboxModule = mock(async () => createFakeSandboxModule());

        const result = await resolveShellBackend("sandbox", { loadSandboxModule });

        expect(result).toBe("sandbox");
        expect(loadSandboxModule).toHaveBeenCalledTimes(1);
      });

      test("auto-discovery falls back to 'local' when loader fails", async () => {
        const loadSandboxModule = mock(async () => {
          throw new Error("missing");
        });

        const result = await resolveShellBackend(undefined, { loadSandboxModule });

        expect(result).toBe("local");
      });

      test("explicit 'sandbox' throws when loader fails", async () => {
        const loadSandboxModule = mock(async () => {
          throw new Error("missing");
        });

        await expect(resolveShellBackend("sandbox", { loadSandboxModule })).rejects.toThrow(
          "@obsku/tool-shell-sandbox is not installed"
        );
      });
    });
  });

  describe("loadSandboxExecutor", () => {
    test("returns injected module when loader provided", async () => {
      const fakeModule = createFakeSandboxModule();

      const result = await loadSandboxExecutor({
        loadSandboxModule: async () => fakeModule,
      });

      expect(result.SandboxedShellExecutor).toBe(fakeModule.SandboxedShellExecutor);
      expect(result.createSandboxedExec).toBe(fakeModule.createSandboxedExec);
      expect(result.sandboxedExec).toBe(fakeModule.sandboxedExec);
    });
  });
});
