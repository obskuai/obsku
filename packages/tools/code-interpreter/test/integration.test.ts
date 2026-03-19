import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  type CodeExecutor,
  type CodeInterpreterOptions,
  codeInterpreter,
  createCodeInterpreter,
  createWorkspace,
  type ExecutionOptions,
  type ExecutionResult,
  LocalProcessExecutor,
  PathTraversalError,
  SessionManager,
  type SessionOptions,
  type SupportedLanguage,
  type WorkspaceContext,
} from "../src/index";
import { codeInterpreterParams } from "../src/plugin-builder";

type PluginResult = { isError?: boolean; result: string };

async function runPlugin(
  p: ReturnType<typeof createCodeInterpreter>,
  input: Record<string, unknown>
): Promise<PluginResult> {
  return Effect.runPromise(p.execute(input)) as Promise<PluginResult>;
}

class ThrowingExecutor extends LocalProcessExecutor {
  override async execute(_opts: ExecutionOptions): Promise<ExecutionResult> {
    throw new Error("simulated executor failure");
  }
}

describe("package exports", () => {
  test("codeInterpreter default instance shape", () => {
    expect(codeInterpreter.name).toBe("code_interpreter");
    expect(typeof codeInterpreter.description).toBe("string");
    expect(codeInterpreter.description.length).toBeGreaterThan(0);
    expect(typeof codeInterpreter.execute).toBe("function");
    expect(Array.isArray(codeInterpreter.directives)).toBe(true);
  });

  test("createCodeInterpreter creates runnable plugin instances", async () => {
    const a = createCodeInterpreter({ backend: "local" });
    const b = createCodeInterpreter({ backend: "local" });

    const [resultA, resultB] = await Promise.all([
      runPlugin(a, { code: `console.log("from-a")`, language: "javascript" }),
      runPlugin(b, { code: `console.log("from-b")`, language: "javascript" }),
    ]);

    expect(JSON.parse(resultA.result).stdout.trim()).toBe("from-a");
    expect(JSON.parse(resultB.result).stdout.trim()).toBe("from-b");
  });

  test("LocalProcessExecutor satisfies CodeExecutor interface", () => {
    const e: CodeExecutor = new LocalProcessExecutor();
    expect(e.name).toBe("local-process");
    expect(e.supportedLanguages).toContain("python");
    expect(e.supportedLanguages).toContain("javascript");
    expect(e.supportedLanguages).toContain("typescript");
    expect(typeof e.initialize).toBe("function");
    expect(typeof e.execute).toBe("function");
    expect(typeof e.dispose).toBe("function");
  });

  test("SessionManager exposes expected methods", () => {
    const sm = new SessionManager();
    expect(typeof sm.create).toBe("function");
    expect(typeof sm.execute).toBe("function");
    expect(typeof sm.destroy).toBe("function");
    expect(typeof sm.destroyAll).toBe("function");
  });

  test("PathTraversalError properties", () => {
    const err = new PathTraversalError("../evil.txt");
    expect(err._tag).toBe("PathTraversalError");
    expect(err.name).toBe("PathTraversalError");
    expect(err.requestedPath).toBe("../evil.txt");
    expect(err.message).toContain("../evil.txt");
    expect(err).toBeInstanceOf(Error);
  });

  test("createWorkspace returns WorkspaceContext", async () => {
    const ws: WorkspaceContext = await createWorkspace();
    expect(typeof ws.dir).toBe("string");
    expect(typeof ws.cleanup).toBe("function");
    expect(typeof ws.stageFile).toBe("function");
    expect(typeof ws.collectOutputFiles).toBe("function");
    await ws.cleanup();
  });

  test("type-level: SupportedLanguage, ExecutionOptions, SessionOptions, CodeInterpreterOptions are assignable", () => {
    const lang: SupportedLanguage = "python";
    const opts: ExecutionOptions = { code: "x=1", language: lang };
    const sessionOpts: SessionOptions = { language: "javascript" };
    const pluginOpts: CodeInterpreterOptions = {};
    void opts;
    void sessionOpts;
    void pluginOpts;
  });
});

describe("stateless Python execution roundtrip", () => {
  test("stdout captured, success=true", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `print("hello from python")`,
      language: "python",
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("hello from python");
    expect(result.exitCode).toBe(0);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.isTimeout).toBeFalsy();
    expect(result.outputFiles).toBeUndefined();
  });

  test("stderr captured separately from stdout", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `import sys
sys.stderr.write("py-err\\n")
print("py-out")`,
      language: "python",
    });
    expect(result.stdout).toContain("py-out");
    expect(result.stderr).toContain("py-err");
  });

  test("arithmetic result is correct", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `print(6 * 7)`,
      language: "python",
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("42");
  });
});

describe("stateless JavaScript execution roundtrip", () => {
  test("stdout captured, success=true", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `console.log("hello from javascript")`,
      language: "javascript",
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("hello from javascript");
    expect(result.exitCode).toBe(0);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.isTimeout).toBeFalsy();
  });

  test("Node.js built-ins available", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `const os = require("os"); console.log(typeof os.platform());`,
      language: "javascript",
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("string");
  });

  test("stderr captured", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `process.stderr.write("js stderr\n")`,
      language: "javascript",
    });
    expect(result.stderr).toContain("js stderr");
  });
});

describe("stateless TypeScript execution roundtrip", () => {
  test("stdout captured via bun, success=true", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `const greeting: string = "hello from typescript";\nconsole.log(greeting);`,
      language: "typescript",
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("hello from typescript");
    expect(result.exitCode).toBe(0);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  test("interface and typed arithmetic", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `
interface Point { x: number; y: number; }
const p: Point = { x: 3, y: 4 };
const dist: number = Math.sqrt(p.x ** 2 + p.y ** 2);
console.log(dist);
`,
      language: "typescript",
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("5");
  });

  test("generic function executes correctly", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `
function identity<T>(value: T): T { return value; }
console.log(identity<string>("ts generic works"));
`,
      language: "typescript",
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("ts generic works");
  });
});

describe("stateful session: create → execute × 3 → destroy", () => {
  test("Python session preserves variable state across executions", async () => {
    const manager = new SessionManager();
    const sessionId = manager.create("python");
    try {
      const r1 = await manager.execute(sessionId, `counter = 10\nprint("init:", counter)`);
      expect(r1.stdout).toContain("init: 10");

      const r2 = await manager.execute(sessionId, `counter += 5\nprint("after add:", counter)`);
      expect(r2.stdout).toContain("after add: 15");

      const r3 = await manager.execute(sessionId, `print("doubled:", counter * 2)`);
      expect(r3.stdout).toContain("doubled: 30");
    } finally {
      await manager.destroy(sessionId);
    }
  });

  test("destroyed session returns error result without throwing", async () => {
    const manager = new SessionManager();
    const sessionId = manager.create("python");
    await manager.execute(sessionId, `pass`);
    await manager.destroy(sessionId);
    const result = await manager.execute(sessionId, `print("unreachable")`);
    expect(result.success).toBe(false);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  test("destroyAll resolves cleanly across multiple sessions", async () => {
    const manager = new SessionManager();
    manager.create("python");
    manager.create("python");
    manager.create("python");
    return expect(manager.destroyAll()).resolves.toBeUndefined();
  });
});

describe("file I/O: input CSV → Python process → output file", () => {
  test("Python reads CSV, computes average, writes summary file", async () => {
    const csvContent = `name,score\nAlice,95\nBob,87\nCarol,92\n`;
    const result = await new LocalProcessExecutor().execute({
      code: `
import csv

with open('students.csv', 'r') as f:
    reader = csv.DictReader(f)
    rows = list(reader)

total = sum(int(r['score']) for r in rows)
avg = total / len(rows)

with open('summary.txt', 'w') as f:
    f.write(f"Students: {len(rows)}\\n")
    f.write(f"Average score: {avg:.1f}\\n")

print(f"Processed {len(rows)} students, avg={avg:.1f}")
`,
      inputFiles: new Map([["students.csv", csvContent]]),
      language: "python",
    });

    expect(result.success).toBe(true);
    expect(result.stdout).toContain("Processed 3 students");
    expect(result.stdout).toContain("avg=91.3");
    expect(result.outputFiles).toBeDefined();
    expect(result.outputFiles!.has("summary.txt")).toBe(true);
    const summary = new TextDecoder().decode(result.outputFiles!.get("summary.txt"));
    expect(summary).toContain("Students: 3");
    expect(summary).toContain("Average score: 91.3");
    expect(result.outputFiles!.has("students.csv")).toBe(false);
  });

  test("binary input accessible to Python, processed output written", async () => {
    const pngMagic = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const result = await new LocalProcessExecutor().execute({
      code: `
with open('header.bin', 'rb') as f:
    data = f.read()
with open('hex.txt', 'w') as f:
    f.write(' '.join(f'{b:02x}' for b in data))
print("bytes:", len(data))
`,
      inputFiles: new Map([["header.bin", pngMagic]]),
      language: "python",
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("bytes: 4");
    const hexOut = new TextDecoder().decode(result.outputFiles!.get("hex.txt"));
    expect(hexOut.trim()).toBe("89 50 4e 47");
  });
});

describe("error propagation", () => {
  test("Python syntax error: success=false, SyntaxError in stderr", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `def broken(:`,
      language: "python",
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/SyntaxError/i);
    expect(result.isTimeout).toBeFalsy();
  });

  test("JavaScript syntax error: success=false, stderr non-empty", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `function broken( {`,
      language: "javascript",
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  test("Python ZeroDivisionError: captured in stderr", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `x = 1 / 0`,
      language: "python",
    });
    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/ZeroDivisionError/i);
  });

  test("JavaScript runtime throw: error message captured in stderr", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `throw new Error("intentional runtime error");`,
      language: "javascript",
    });
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("intentional runtime error");
  });

  test("Python infinite loop: isTimeout=true after short deadline", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `while True: pass`,
      language: "python",
      timeoutMs: 300,
    });
    expect(result.isTimeout).toBe(true);
    expect(result.success).toBe(false);
  });

  test("JavaScript infinite loop: isTimeout=true after short deadline", async () => {
    const result = await new LocalProcessExecutor().execute({
      code: `const s = Date.now(); while (Date.now() - s < 10000) {}`,
      language: "javascript",
      timeoutMs: 300,
    });
    expect(result.isTimeout).toBe(true);
    expect(result.success).toBe(false);
  });

  test("input file over 10MB limit: executor rejects with size error", async () => {
    const bigFile = new Uint8Array(10 * 1024 * 1024 + 1);
    return expect(
      new LocalProcessExecutor().execute({
        code: `print("hi")`,
        inputFiles: new Map([["big.bin", bigFile]]),
        language: "python",
      })
    ).rejects.toThrow("10MB");
  });
});

describe("plugin ToolOutput format", () => {
  test("successful run: result is JSON ExecutionResult, isError absent", async () => {
    const output = await runPlugin(createCodeInterpreter({ backend: "local" }), {
      code: `console.log("plugin test")`,
      language: "javascript",
    });
    expect(typeof output.result).toBe("string");
    expect(output.isError).toBe(false);
    const parsed = JSON.parse(output.result) as ExecutionResult;
    expect(parsed.success).toBe(true);
    expect(parsed.stdout).toContain("plugin test");
    expect(typeof parsed.executionTimeMs).toBe("number");
  });

  test("process non-zero exit: ExecutionResult in result, no plugin isError", async () => {
    const output = await runPlugin(createCodeInterpreter({ backend: "local" }), {
      code: `process.exit(42)`,
      language: "javascript",
    });
    expect(output.isError).toBe(false);
    const parsed = JSON.parse(output.result) as ExecutionResult;
    expect(parsed.success).toBe(false);
    expect(parsed.exitCode).toBe(42);
  });

  test("executor throws: isError=true with error message propagated", async () => {
    const output = await runPlugin(createCodeInterpreter({ executor: new ThrowingExecutor() }), {
      code: `print("hi")`,
      language: "python",
    });
    expect(output.isError).toBe(true);
    expect(typeof output.result).toBe("string");
    expect(output.result).toContain("simulated executor failure");
  });

  test("custom executor injected via options is invoked for execution", async () => {
    let capturedCode = "";
    class SpyExecutor extends LocalProcessExecutor {
      override async execute(opts: ExecutionOptions): Promise<ExecutionResult> {
        capturedCode = opts.code;
        return super.execute(opts);
      }
    }
    await runPlugin(createCodeInterpreter({ executor: new SpyExecutor() }), {
      code: `console.log("spy")`,
      language: "javascript",
    });
    expect(capturedCode).toBe(`console.log("spy")`);
  });

  test("outputFiles serialized as base64 strings inside plugin content", async () => {
    const output = await runPlugin(createCodeInterpreter({ backend: "local" }), {
      code: `
const fs = require("fs");
fs.writeFileSync("out.txt", "serialized");
`,
      language: "javascript",
    });
    expect(output.isError).toBe(false);
    const parsed = JSON.parse(output.result) as { outputFiles?: Record<string, string> };
    expect(parsed.outputFiles).toBeDefined();
    expect(typeof parsed.outputFiles!["out.txt"]).toBe("string");
    const decoded = Buffer.from(parsed.outputFiles!["out.txt"], "base64").toString("utf8");
    expect(decoded).toBe("serialized");
  });

  test("accepts string content in inputFiles record", async () => {
    const output = await runPlugin(createCodeInterpreter({ backend: "local" }), {
      code: `
const fs = require("fs");
const content = fs.readFileSync("input.txt", "utf8");
console.log(content);
        `,
      inputFiles: { "input.txt": "hello from file" },
      language: "javascript",
    });
    expect(output.isError).toBe(false);
    const parsed = JSON.parse(output.result) as ExecutionResult;
    expect(parsed.stdout.trim()).toBe("hello from file");
  });

  test("accepts Buffer content in inputFiles record as object-form binary input", async () => {
    const output = await runPlugin(createCodeInterpreter({ backend: "local" }), {
      code: `
const fs = require("fs");
const content = fs.readFileSync("buffer.bin");
console.log(Array.from(content.values()).join(","));
        `,
      inputFiles: { "buffer.bin": Buffer.from([7, 8, 9]) },
      language: "javascript",
    });
    expect(output.isError).toBe(false);
    const parsed = JSON.parse(output.result) as ExecutionResult;
    expect(parsed.stdout.trim()).toBe("7,8,9");
  });

  test("accepts Uint8Array content in inputFiles record", async () => {
    const binaryContent = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const output = await runPlugin(createCodeInterpreter({ backend: "local" }), {
      code: `
const fs = require("fs");
const content = fs.readFileSync("binary.bin");
console.log(content.length);
        `,
      inputFiles: { "binary.bin": binaryContent },
      language: "javascript",
    });
    expect(output.isError).toBe(false);
    const parsed = JSON.parse(output.result) as ExecutionResult;
    expect(parsed.stdout.trim()).toBe("5");
  });

  test("handles empty inputFiles record", async () => {
    const output = await runPlugin(createCodeInterpreter({ backend: "local" }), {
      code: `console.log("no files")`,
      inputFiles: {},
      language: "javascript",
    });
    expect(output.isError).toBe(false);
    const parsed = JSON.parse(output.result) as ExecutionResult;
    expect(parsed.stdout.trim()).toBe("no files");
  });

  test("handles undefined inputFiles (omitted)", async () => {
    const output = await runPlugin(createCodeInterpreter({ backend: "local" }), {
      code: `console.log("no files param")`,
      language: "javascript",
    });
    expect(output.isError).toBe(false);
    const parsed = JSON.parse(output.result) as ExecutionResult;
    expect(parsed.stdout.trim()).toBe("no files param");
  });

  test("inputFiles schema accepts string, Uint8Array, and Buffer values", () => {
    const parsed = codeInterpreterParams.safeParse({
      code: `console.log("ok")`,
      inputFiles: {
        "buffer.bin": Buffer.from("buffer"),
        "bytes.bin": new Uint8Array([1, 2, 3]),
        "text.txt": "content",
      },
      language: "javascript",
    });

    expect(parsed.success).toBe(true);
  });

  test("inputFiles schema rejects plain object payloads that only look binary-like", () => {
    const parsed = codeInterpreterParams.safeParse({
      code: `console.log("ok")`,
      inputFiles: {
        "bufferish.bin": { data: [98, 117, 102], type: "Buffer" },
      },
      language: "javascript",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({
          message: "inputFiles values must be string or Uint8Array",
          path: ["inputFiles", "bufferish.bin"],
        })
      );
    }
  });

  test("plugin rejects malformed inputFiles object payloads before execution", async () => {
    return expect(
      runPlugin(createCodeInterpreter({ backend: "local" }), {
        code: `console.log("should not run")`,
        inputFiles: {
          "bufferish.bin": { data: [98, 117, 102], type: "Buffer" },
        },
        language: "javascript",
      })
    ).rejects.toThrow("inputFiles values must be string or Uint8Array");
  });

  test("plugin rejects array payloads in inputFiles values", async () => {
    return expect(
      runPlugin(createCodeInterpreter({ backend: "local" }), {
        code: `console.log("should not run")`,
        inputFiles: {
          "array.bin": [1, 2, 3],
        },
        language: "javascript",
      })
    ).rejects.toThrow("inputFiles values must be string or Uint8Array");
  });
});

describe("ExecutionResult serialization contract", () => {
  test("serializeExecutionResult converts outputFiles Map to base64 Record", async () => {
    const output = await runPlugin(createCodeInterpreter({ backend: "local" }), {
      code: `
const fs = require("fs");
fs.writeFileSync("a.txt", "file-a");
fs.writeFileSync("b.txt", "file-b");
        `,
      language: "javascript",
    });
    expect(output.isError).toBe(false);

    const parsed = JSON.parse(output.result) as {
      outputFiles?: Record<string, string>;
      success: boolean;
    };
    expect(parsed.success).toBe(true);
    expect(parsed.outputFiles).toBeDefined();
    expect(Object.keys(parsed.outputFiles!)).toHaveLength(2);
    expect(typeof parsed.outputFiles!["a.txt"]).toBe("string");
    expect(typeof parsed.outputFiles!["b.txt"]).toBe("string");

    // Verify base64 encoding
    const decodedA = Buffer.from(parsed.outputFiles!["a.txt"], "base64").toString();
    expect(decodedA).toBe("file-a");
  });

  test("ExecutionResult structure is stable for contract compatibility", async () => {
    const output = await runPlugin(createCodeInterpreter({ backend: "local" }), {
      code: `console.log("output"); console.error("error")`,
      language: "javascript",
    });
    expect(output.isError).toBe(false);

    const parsed = JSON.parse(output.result);

    // Required fields for ExecutionResult contract
    expect(typeof parsed.success).toBe("boolean");
    expect(typeof parsed.stdout).toBe("string");
    expect(typeof parsed.stderr).toBe("string");
    expect(typeof parsed.executionTimeMs).toBe("number");

    // Optional fields should be present when applicable
    expect(parsed.exitCode).toBeDefined(); // Always present in this executor
  });
});
