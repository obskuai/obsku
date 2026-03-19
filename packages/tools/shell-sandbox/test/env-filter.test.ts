import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { SandboxedShellExecutor } from "../src/executor";

describe("env variable filtering", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    process.env.OBSKU_DEBUG = "1";
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.OBSKU_DEBUG;
  });

  test("blocks secret-like vars by default", async () => {
    const executor = new SandboxedShellExecutor({ fs: "memory" });

    try {
      const result = await executor.execute({
        command: 'printf "%s|%s" "${MY_SECRET:-missing}" "${PATH_VAR:-present}"',
        env: { MY_SECRET: "secret123", PATH_VAR: "visible" },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("missing|visible");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("MY_SECRET"));
    } finally {
      await executor.dispose();
    }
  });

  test("logs warning only for filtered vars", async () => {
    const executor = new SandboxedShellExecutor({ fs: "memory" });

    try {
      await executor.execute({
        command: "echo test",
        env: { AWS_ACCESS_KEY: "key123", PUBLIC_VAR: "public" },
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [warning] = warnSpy.mock.calls[0] ?? [];
      expect(String(warning)).toContain("AWS_ACCESS_KEY");
      expect(String(warning)).not.toContain("PUBLIC_VAR");
    } finally {
      await executor.dispose();
    }
  });

  test("suppresses warning when warn false", async () => {
    const executor = new SandboxedShellExecutor({
      envFilter: { mode: "blocklist", warn: false },
      fs: "memory",
    });

    try {
      const result = await executor.execute({
        command: 'printf "%s" "${MY_SECRET:-missing}"',
        env: { MY_SECRET: "x" },
      });

      expect(result.stdout).toBe("missing");
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      await executor.dispose();
    }
  });

  test("allowlist mode keeps only matching vars", async () => {
    const executor = new SandboxedShellExecutor({
      envFilter: { mode: "allowlist", patterns: ["PUBLIC_*"] },
      fs: "memory",
    });

    try {
      const result = await executor.execute({
        command:
          'printf "%s|%s|%s" "${PUBLIC_VAR:-missing}" "${MY_SECRET:-missing}" "${AWS_KEY:-missing}"',
        env: {
          AWS_KEY: "key",
          MY_SECRET: "secret",
          PUBLIC_VAR: "public",
        },
      });

      expect(result.stdout).toBe("public|missing|missing");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [warning] = warnSpy.mock.calls[0] ?? [];
      expect(String(warning)).toContain("MY_SECRET");
      expect(String(warning)).toContain("AWS_KEY");
      expect(String(warning)).not.toContain("PUBLIC_VAR");
    } finally {
      await executor.dispose();
    }
  });

  test("mode none disables filtering", async () => {
    const executor = new SandboxedShellExecutor({
      envFilter: { mode: "none" },
      fs: "memory",
    });

    try {
      const result = await executor.execute({
        command: 'printf "%s" "$MY_SECRET"',
        env: { MY_SECRET: "secret" },
      });

      expect(result.stdout).toBe("secret");
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      await executor.dispose();
    }
  });
});
