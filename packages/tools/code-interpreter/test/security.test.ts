import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { codeInterpreter, LocalProcessExecutor, SessionManager } from "../src/index";
import { filterEnvVars } from "@obsku/framework";
import { PathTraversalError } from "../src/workspace";

const SECURITY_WARNING =
  "WARNING: This tool executes arbitrary code in a local subprocess. " +
  "It does NOT provide OS-level sandboxing (no container, no seccomp). " +
  "Isolation guarantees: workspace directories are ephemeral temp dirs scoped per " +
  "execution, output file collection is restricted to the workspace, and path " +
  "traversal in input file names is rejected. Child-process environment variables " +
  "matching common secret patterns are filtered by default, but you should still avoid " +
  "running this tool in a process that holds production credentials. For production " +
  "deployments, wrap execution inside a container or VM.";

describe("Security: env variable filtering", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.OBSKU_DEBUG = "1";
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.OBSKU_DEBUG;
  });

  test("blocks SECRET pattern by default", () => {
    const env = { MY_SECRET: "secret123", PATH: "/usr/bin" };
    const filtered = filterEnvVars(env, { mode: "blocklist" });

    expect(filtered.MY_SECRET).toBeUndefined();
    expect(filtered.PATH).toBe("/usr/bin");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("MY_SECRET"));
  });

  test("logs warning when vars filtered", () => {
    const env = { AWS_ACCESS_KEY: "key123", PUBLIC_VAR: "public" };
    filterEnvVars(env, { mode: "blocklist" });

    expect(warnSpy).toHaveBeenCalled();
    const warning = warnSpy.mock.calls[0]?.[0];
    expect(warning).toContain("AWS_ACCESS_KEY");
    expect(warning).not.toContain("PUBLIC_VAR");
  });

  test("suppresses warning when warn: false", () => {
    const env = { MY_SECRET: "x" };
    filterEnvVars(env, { mode: "blocklist", warn: false });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("allows allowlist mode", () => {
    const env = { PUBLIC_VAR: "public", MY_SECRET: "secret", AWS_KEY: "key" };
    const filtered = filterEnvVars(env, { mode: "allowlist", patterns: ["PUBLIC_*"] });

    expect(filtered.PUBLIC_VAR).toBe("public");
    expect(filtered.MY_SECRET).toBeUndefined();
    expect(filtered.AWS_KEY).toBeUndefined();
  });

  test("returns all vars when mode: none", () => {
    const env = { MY_SECRET: "secret", PATH: "/usr/bin" };
    const filtered = filterEnvVars(env, { mode: "none" });

    expect(filtered).toEqual(env);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("uses default blocklist patterns when not specified", () => {
    const env = {
      AUTH_TOKEN: "t",
      API_KEY: "k",
      AWS_SECRET_KEY: "a",
      GITHUB_TOKEN: "g",
      MY_SECRET: "s",
      PUBLIC_VALUE: "v",
      USER_PASSWORD: "p",
    };
    const filtered = filterEnvVars(env, { mode: "blocklist" });

    expect(filtered.MY_SECRET).toBeUndefined();
    expect(filtered.API_KEY).toBeUndefined();
    expect(filtered.AUTH_TOKEN).toBeUndefined();
    expect(filtered.USER_PASSWORD).toBeUndefined();
    expect(filtered.AWS_SECRET_KEY).toBeUndefined();
    expect(filtered.GITHUB_TOKEN).toBeUndefined();
    expect(filtered.PUBLIC_VALUE).toBe("v");
  });

  test("executor filters matching vars from child env by default", async () => {
    const executor = new LocalProcessExecutor();
    const secretName = `OBSKU_SECRET_${Date.now()}`;
    const publicName = `OBSKU_PUBLIC_${Date.now()}`;
    process.env[secretName] = "top-secret";
    process.env[publicName] = "visible";

    try {
      const result = await executor.execute({
        code: `console.log(JSON.stringify({ secret: process.env[${JSON.stringify(secretName)}], public: process.env[${JSON.stringify(publicName)}] }))`,
        language: "javascript",
      });

      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe(JSON.stringify({ public: "visible", secret: undefined }));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(secretName));
    } finally {
      delete process.env[secretName];
      delete process.env[publicName];
      await executor.dispose();
    }
  });
});

describe("Security: path traversal blocking", () => {
  let executor: LocalProcessExecutor;

  beforeEach(() => {
    executor = new LocalProcessExecutor();
  });

  afterEach(async () => {
    await executor.dispose();
  });

  test("rejects inputFile key with '../../../etc/passwd' (throws PathTraversalError)", async () => {
    await expect(
      executor.execute({
        code: `console.log("hi")`,
        inputFiles: new Map([["../../../etc/passwd", "evil"]]),
        language: "javascript",
      })
    ).rejects.toThrow(PathTraversalError);
  });

  test("rejects inputFile key with absolute path '/etc/passwd'", async () => {
    await expect(
      executor.execute({
        code: `console.log("hi")`,
        inputFiles: new Map([["/etc/passwd", "evil"]]),
        language: "javascript",
      })
    ).rejects.toThrow(PathTraversalError);
  });

  test("rejects inputFile key with nested traversal 'sub/../../../etc/shadow'", async () => {
    await expect(
      executor.execute({
        code: `console.log("hi")`,
        inputFiles: new Map([["sub/../../../etc/shadow", "evil"]]),
        language: "javascript",
      })
    ).rejects.toThrow(PathTraversalError);
  });

  test("code writing to absolute path outside workspace is not returned in outputFiles", async () => {
    const marker = `/tmp/obsku-security-traversal-${Date.now()}.txt`;
    const result = await executor.execute({
      code: `
        const fs = require("fs");
        try { fs.writeFileSync(${JSON.stringify(marker)}, "escaped"); } catch (_) {}
        console.log("done");
      `,
      language: "javascript",
    });

    expect(result.stdout.trim()).toBe("done");
    const escapedKey = Array.from(result.outputFiles?.keys() ?? []).find((k) =>
      k.includes("traversal")
    );
    expect(escapedKey).toBeUndefined();
  });

  test("Python: open('../../../etc/passwd') does not expose outside-workspace files in outputFiles", async () => {
    const result = await executor.execute({
      code: `
import os
try:
    with open("../../../etc/passwd") as f:
        content = f.read()
    with open("leaked.txt", "w") as out:
        out.write(content[:50])
except Exception:
    pass
print("done")
`,
      language: "python",
    });

    expect(result.stdout.trim()).toBe("done");
    const hasTraversal = Array.from(result.outputFiles?.keys() ?? []).some(
      (k) => k.includes("passwd") || k.includes("shadow") || k.includes("etc")
    );
    expect(hasTraversal).toBe(false);
  });
});

describe("Security: clean environment", () => {
  let executor: LocalProcessExecutor;

  beforeEach(() => {
    executor = new LocalProcessExecutor();
  });

  afterEach(async () => {
    await executor.dispose();
  });

  test("AWS_SECRET_ACCESS_KEY is not exposed to child process when unset in test env", async () => {
    if (process.env.AWS_SECRET_ACCESS_KEY !== undefined) {
      process.stderr.write(
        "[security.test] Skipping clean-env test: AWS_SECRET_ACCESS_KEY is set in test env.\n"
      );
      return;
    }

    const result = await executor.execute({
      code: `console.log(String(process.env.AWS_SECRET_ACCESS_KEY))`,
      language: "javascript",
    });

    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("undefined");
  });

  test("Python: AWS_SECRET_ACCESS_KEY is None when unset in test env", async () => {
    if (process.env.AWS_SECRET_ACCESS_KEY !== undefined) {
      process.stderr.write("[security.test] Skipping: AWS_SECRET_ACCESS_KEY set in test env.\n");
      return;
    }

    const result = await executor.execute({
      code: `import os\nprint(os.environ.get("AWS_SECRET_ACCESS_KEY"))`,
      language: "python",
    });

    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("None");
  });

  test("unique test marker not present in child when not set in parent", async () => {
    const uniqueVar = `OBSKU_SECURITY_TEST_MARKER_${Date.now()}`;
    expect(process.env[uniqueVar]).toBeUndefined();

    const result = await executor.execute({
      code: `console.log(String(process.env[${JSON.stringify(uniqueVar)}]))`,
      language: "javascript",
    });

    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("undefined");
  });
});

describe("Security: timeout enforcement", () => {
  let executor: LocalProcessExecutor;

  beforeEach(() => {
    executor = new LocalProcessExecutor();
  });

  afterEach(async () => {
    await executor.dispose();
  });

  test("JavaScript infinite loop is killed within timeout", async () => {
    const TIMEOUT_MS = 500;
    const GRACE_MS = 4000;

    const start = Date.now();
    const result = await executor.execute({
      code: `while (true) {}`,
      language: "javascript",
      timeoutMs: TIMEOUT_MS,
    });
    const elapsed = Date.now() - start;

    expect(result.isTimeout).toBe(true);
    expect(result.success).toBe(false);
    expect(elapsed).toBeLessThan(TIMEOUT_MS + GRACE_MS);
  });

  test("Python infinite loop is killed within timeout", async () => {
    const TIMEOUT_MS = 500;
    const GRACE_MS = 4000;

    const start = Date.now();
    const result = await executor.execute({
      code: `while True: pass`,
      language: "python",
      timeoutMs: TIMEOUT_MS,
    });
    const elapsed = Date.now() - start;

    expect(result.isTimeout).toBe(true);
    expect(result.success).toBe(false);
    expect(elapsed).toBeLessThan(TIMEOUT_MS + GRACE_MS);
  });

  test("process sleeping beyond timeout is killed", async () => {
    const TIMEOUT_MS = 300;
    const start = Date.now();

    const result = await executor.execute({
      code: `
        const { execSync } = require("child_process");
        execSync("sleep 60");
      `,
      language: "javascript",
      timeoutMs: TIMEOUT_MS,
    });
    const elapsed = Date.now() - start;

    expect(result.isTimeout).toBe(true);
    expect(elapsed).toBeLessThan(TIMEOUT_MS + 5000);
  });
});

describe("Security: workspace isolation per execution", () => {
  let executor: LocalProcessExecutor;

  beforeEach(() => {
    executor = new LocalProcessExecutor();
  });

  afterEach(async () => {
    await executor.dispose();
  });

  test("files written in execution 1 are not visible in execution 2", async () => {
    await executor.execute({
      code: `
        const fs = require("fs");
        fs.writeFileSync("secret_data.txt", "sensitive-value");
        console.log("wrote");
      `,
      language: "javascript",
    });

    const result = await executor.execute({
      code: `
        const fs = require("fs");
        try {
          fs.readFileSync("secret_data.txt", "utf-8");
          console.log("found");
        } catch (_) {
          console.log("not found");
        }
      `,
      language: "javascript",
    });

    expect(result.stdout.trim()).toBe("not found");
  });

  test("each execution runs in a distinct working directory", async () => {
    const r1 = await executor.execute({
      code: `console.log(process.cwd())`,
      language: "javascript",
    });
    const r2 = await executor.execute({
      code: `console.log(process.cwd())`,
      language: "javascript",
    });

    const dir1 = r1.stdout.trim();
    const dir2 = r2.stdout.trim();

    expect(dir1).toContain("obsku-code-");
    expect(dir2).toContain("obsku-code-");
    expect(dir1).not.toBe(dir2);
  });

  test("workspace temp directory is cleaned up after execution", async () => {
    const { readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");

    const tmp = tmpdir();
    const before = (await readdir(tmp)).filter((f) => f.startsWith("obsku-code-")).length;

    await executor.execute({
      code: `console.log("done")`,
      language: "javascript",
    });

    const after = (await readdir(tmp)).filter((f) => f.startsWith("obsku-code-")).length;
    expect(after).toBeLessThanOrEqual(before);
  });

  test("Python: files from a prior execution are absent in the next", async () => {
    await executor.execute({
      code: `
with open("prior.txt", "w") as f:
    f.write("stale")
print("wrote")
`,
      language: "python",
    });

    const result = await executor.execute({
      code: `
import os
print(os.path.exists("prior.txt"))
`,
      language: "python",
    });

    expect(result.stdout.trim()).toBe("False");
  });
});

describe("Security: session isolation", () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  afterEach(async () => {
    await sessionManager.destroyAll();
  });

  test("sessions run in distinct working directories", async () => {
    const s1 = sessionManager.create("python");
    const s2 = sessionManager.create("python");

    const r1 = await sessionManager.execute(s1, `import os\nprint(os.getcwd())`);
    const r2 = await sessionManager.execute(s2, `import os\nprint(os.getcwd())`);

    const dir1 = r1.stdout.trim();
    const dir2 = r2.stdout.trim();

    expect(dir1).toContain("obsku-code-");
    expect(dir2).toContain("obsku-code-");
    expect(dir1).not.toBe(dir2);
  });

  test("file written in session 1 is not visible in session 2", async () => {
    const s1 = sessionManager.create("python");
    const s2 = sessionManager.create("python");

    await sessionManager.execute(
      s1,
      `with open("session1_secret.txt", "w") as f:\n    f.write("s1-data")\nprint("wrote")`
    );

    const result = await sessionManager.execute(
      s2,
      `import os\nprint(os.path.exists("session1_secret.txt"))`
    );

    expect(result.stdout.trim()).toBe("False");
  });

  test("session A file not visible in session B (cross-session isolation)", async () => {
    const sA = sessionManager.create("python");
    const sB = sessionManager.create("python");

    await sessionManager.execute(
      sA,
      `with open("session_a_data.txt", "w") as f:\n    f.write("from-session-a")\nprint("ok")`
    );

    const result = await sessionManager.execute(
      sB,
      `import os\nprint(os.path.exists("session_a_data.txt"))`
    );

    expect(result.stdout.trim()).toBe("False");
  });

  test("destroying session A does not affect session B", async () => {
    const sA = sessionManager.create("python");
    const sB = sessionManager.create("python");

    await sessionManager.destroy(sA);

    const result = await sessionManager.execute(sB, `print("session-b-alive")`);

    expect(result.stdout.trim()).toBe("session-b-alive");
  });

  test("destroyed session returns error result for further execute calls", async () => {
    const s1 = sessionManager.create("javascript");
    await sessionManager.destroy(s1);

    const result = await sessionManager.execute(s1, `console.log("hi")`);

    expect(result.success).toBe(false);
    expect(result.stderr).toContain(s1);
  });
});

describe("Security: plugin configuration", () => {
  test("plugin exposes a security-warning directive", () => {
    expect(codeInterpreter.directives).toBeDefined();
    expect(Array.isArray(codeInterpreter.directives)).toBe(true);
    expect(codeInterpreter.directives!.length).toBeGreaterThan(0);

    const securityDirective = codeInterpreter.directives!.find(
      (d) => d.name === "security-warning"
    );
    expect(securityDirective).toBeDefined();
    expect(typeof securityDirective!.inject).toBe("string");
    expect(securityDirective!.inject).toContain("Warning");
  });

  test("security directive match() returns true for all inputs (always-on guard)", () => {
    const securityDirective = codeInterpreter.directives!.find(
      (d) => d.name === "security-warning"
    );
    expect(securityDirective!.match("", {})).toBe(true);
  });

  test("SECURITY_WARNING constant is a non-empty string", () => {
    expect(typeof SECURITY_WARNING).toBe("string");
    expect(SECURITY_WARNING.length).toBeGreaterThan(0);
    expect(SECURITY_WARNING).toContain("WARNING");
  });
});
