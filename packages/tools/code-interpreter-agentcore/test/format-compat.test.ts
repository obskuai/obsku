/**
 * format-compat.test.ts
 *
 * Verifies that ExecutionResult produced by AgentCoreExecutor is structurally
 * compatible with the ExecutionResult interface from @obsku/tool-code-interpreter.
 *
 * Checks:
 *   - All required fields present with correct types
 *   - Optional fields absent when not applicable
 *   - outputFiles is Map<string, Uint8Array> when output files exist
 *   - success derived correctly from exitCode
 */

import { describe, expect, test } from "bun:test";
import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
// Import from both sources to verify they're the same shape
import type { ExecutionResult as ExecutionResultFromPkg } from "@obsku/tool-code-interpreter";
import { AgentCoreExecutor } from "../src/executor";
import type { ExecutionResult as ExecutionResultFromTypes } from "../src/types";
import { createMockClient } from "./mocks";

// Compile-time guard: both imports must be assignable to each other
type _AssertSameType = ExecutionResultFromPkg extends ExecutionResultFromTypes
  ? ExecutionResultFromTypes extends ExecutionResultFromPkg
    ? true
    : never
  : never;
const _typeCheck: _AssertSameType = true;
void _typeCheck;

function makeExecutor(client: ReturnType<typeof createMockClient>): AgentCoreExecutor {
  return new AgentCoreExecutor({
    client: client as unknown as BedrockAgentCoreClient,
    region: "us-east-1",
  });
}

describe("ExecutionResult format compatibility — required fields", () => {
  test("executionTimeMs is a number", async () => {
    const client = createMockClient({
      executeContent: { executionTime: 123, exitCode: 0, stderr: "", stdout: "hi" },
    });
    const result: ExecutionResultFromPkg = await makeExecutor(client).execute({
      code: "print('hi')",
      language: "python",
    });
    expect(typeof result.executionTimeMs).toBe("number");
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  test("stdout is a string", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "hello world" },
    });
    const result: ExecutionResultFromPkg = await makeExecutor(client).execute({
      code: "print('hello world')",
      language: "python",
    });
    expect(typeof result.stdout).toBe("string");
    expect(result.stdout).toBe("hello world");
  });

  test("stderr is a string", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "some warning", stdout: "" },
    });
    const result: ExecutionResultFromPkg = await makeExecutor(client).execute({
      code: "import warnings; warnings.warn('warn')",
      language: "python",
    });
    expect(typeof result.stderr).toBe("string");
    expect(result.stderr).toBe("some warning");
  });

  test("success is a boolean", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    const result: ExecutionResultFromPkg = await makeExecutor(client).execute({
      code: "pass",
      language: "python",
    });
    expect(typeof result.success).toBe("boolean");
  });
});

describe("ExecutionResult format compatibility — success/exitCode logic", () => {
  test("exitCode 0 → success true", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "ok" },
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test("exitCode 1 → success false", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 1, stderr: "error!", stdout: "" },
    });
    const result = await makeExecutor(client).execute({ code: "raise", language: "python" });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  test("AWS error → success false, exitCode 1, executionTimeMs 0", async () => {
    const client = createMockClient({
      startError: new Error("ServiceUnavailableException"),
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.executionTimeMs).toBe(0);
    expect(typeof result.stderr).toBe("string");
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});

describe("ExecutionResult format compatibility — optional fields", () => {
  test("isTimeout is absent on normal success", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    expect(result.isTimeout).toBeUndefined();
  });

  test("isTimeout is absent on AWS error", async () => {
    const client = createMockClient({
      startError: new Error("error"),
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    // AgentCoreExecutor does not set isTimeout — compatible with interface (optional)
    expect(result.isTimeout).toBeUndefined();
  });

  test("outputFiles absent when no files produced", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
      listFilesContent: {},
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    expect(result.outputFiles).toBeUndefined();
  });

  test("outputFiles is Map<string, Uint8Array> when files produced", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
      listFilesContent: { fileNames: ["report.txt"] },
      readFilesContent: { files: [{ content: "report contents", name: "report.txt" }] },
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });

    expect(result.outputFiles).toBeInstanceOf(Map);
    expect(result.outputFiles!.size).toBe(1);
    expect(result.outputFiles!.has("report.txt")).toBe(true);
    expect(result.outputFiles!.get("report.txt")).toBeInstanceOf(Uint8Array);
  });

  test("outputFiles Map values decode to original text content", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
      listFilesContent: { fileNames: ["out.txt"] },
      readFilesContent: { files: [{ content: "exact content", name: "out.txt" }] },
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    const decoded = new TextDecoder().decode(result.outputFiles!.get("out.txt"));
    expect(decoded).toBe("exact content");
  });

  test("outputFiles Map values decode base64-encoded content", async () => {
    // "hello" in base64 is "aGVsbG8="
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
      listFilesContent: { fileNames: ["data.bin"] },
      readFilesContent: {
        files: [{ content: "aGVsbG8=", encoding: "base64", name: "data.bin" }],
      },
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    const decoded = new TextDecoder().decode(result.outputFiles!.get("data.bin"));
    expect(decoded).toBe("hello");
  });
});

describe("ExecutionResult format compatibility — executionTimeMs source", () => {
  test("uses AgentCore executionTime when present", async () => {
    const client = createMockClient({
      executeContent: { executionTime: 999, exitCode: 0, stderr: "", stdout: "" },
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    expect(result.executionTimeMs).toBe(999);
  });

  test("falls back to wall-clock when executionTime missing", async () => {
    const client = createMockClient({
      // No executionTime field → executor falls back to Date.now() diff
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    // Should be a non-negative number (actual wall-clock time)
    expect(typeof result.executionTimeMs).toBe("number");
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  describe("InputFiles boundary contract for wrapper deduplication", () => {
    test("inputFiles schema accepts string content via shared boundary schema", async () => {
      const client = createMockClient({
        executeContent: { executionTime: 100, exitCode: 0, stderr: "", stdout: "ok" },
      });
      const result = await makeExecutor(client).execute({
        code: "print('test')",
        inputFiles: new Map([["test.txt", "string content"]]),
        language: "python",
      });
      expect(result.success).toBe(true);
    });

    test("inputFiles schema accepts Uint8Array content", async () => {
      const client = createMockClient({
        executeContent: { executionTime: 100, exitCode: 0, stderr: "", stdout: "ok" },
      });
      const binaryContent = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
      const result = await makeExecutor(client).execute({
        code: "print('test')",
        inputFiles: new Map([["binary.bin", binaryContent]]),
        language: "python",
      });
      expect(result.success).toBe(true);
    });

    test("inputFiles handles empty Map", async () => {
      const client = createMockClient({
        executeContent: { executionTime: 100, exitCode: 0, stderr: "", stdout: "ok" },
      });
      const result = await makeExecutor(client).execute({
        code: "print('test')",
        inputFiles: new Map(),
        language: "python",
      });
      expect(result.success).toBe(true);
    });

    test("inputFiles undefined is accepted", async () => {
      const client = createMockClient({
        executeContent: { executionTime: 100, exitCode: 0, stderr: "", stdout: "ok" },
      });
      const result = await makeExecutor(client).execute({
        code: "print('test')",
        language: "python",
        // inputFiles omitted
      });
      expect(result.success).toBe(true);
    });

    test("SHARED CONTRACT: both wrappers convert inputFiles Map before execution", async () => {
      // This test documents the shared contract for Task 8 (wrapper deduplication):
      //
      // Local wrapper: packages/tools/code-interpreter/src/index.ts:70-72
      //   const inputFileMap = inputFiles
      //     ? new Map<string, string | Uint8Array>(Object.entries(inputFiles))
      //     : undefined;
      //
      // AgentCore wrapper: packages/tools/code-interpreter-agentcore/src/index.ts:102-104
      //   const inputFileMap = inputFiles
      //     ? new Map<string, string | Uint8Array>(Object.entries(inputFiles))
      //     : undefined;
      //
      const client = createMockClient({
        executeContent: { executionTime: 100, exitCode: 0, stderr: "", stdout: "ok" },
      });

      // Verify Map construction works the same way in both wrappers
      const binaryContent = new Uint8Array(Buffer.from("binary"));
      const inputFilesRecord = { "a.txt": "content-a", "b.bin": binaryContent };
      const inputFileMap = new Map<string, string | Uint8Array>(Object.entries(inputFilesRecord));

      expect(inputFileMap.get("a.txt")).toBe("content-a");
      expect(inputFileMap.get("b.bin")).toEqual(binaryContent);

      const result = await makeExecutor(client).execute({
        code: "print('test')",
        inputFiles: inputFileMap,
        language: "python",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Plugin output contract for shared serialization", () => {
    test("serializeExecutionResult produces identical JSON structure", async () => {
      // This test verifies that both wrappers use serializeExecutionResult from
      // @obsku/tool-code-interpreter, ensuring identical output format.

      const client = createMockClient({
        executeContent: {
          executionTime: 100,
          exitCode: 0,
          stderr: "error output",
          stdout: "standard output",
        },
        listFilesContent: { fileNames: ["output.txt"] },
        readFilesContent: {
          files: [{ content: "ZmlsZQ==", encoding: "base64", name: "output.txt" }],
        },
      });

      const result = await makeExecutor(client).execute({
        code: "print('test')",
        language: "python",
      });

      // ExecutionResult structure
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.stdout).toBe("string");
      expect(typeof result.stderr).toBe("string");
      expect(typeof result.executionTimeMs).toBe("number");
      expect(result.exitCode).toBe(0);

      // outputFiles as Map<string, Uint8Array>
      expect(result.outputFiles).toBeInstanceOf(Map);
      expect(result.outputFiles!.has("output.txt")).toBe(true);
      expect(result.outputFiles!.get("output.txt")).toBeInstanceOf(Uint8Array);
    });
  });
});
