import { beforeEach, describe, expect, test } from "bun:test";
import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { AgentCoreExecutor } from "../src/executor";
import { createMockClient } from "./mocks";

// Helpers to reduce boilerplate
function makeExecutor(client: ReturnType<typeof createMockClient>): AgentCoreExecutor {
  return new AgentCoreExecutor({
    client: client as unknown as BedrockAgentCoreClient,
    region: "us-east-1",
  });
}

// ─── basic properties ────────────────────────────────────────────────────────

describe("AgentCoreExecutor — properties", () => {
  test("name is 'agentcore'", () => {
    const executor = makeExecutor(createMockClient());
    expect(executor.name).toBe("agentcore");
  });

  test("supportedLanguages includes python, javascript, typescript", () => {
    const executor = makeExecutor(createMockClient());
    expect(executor.supportedLanguages).toContain("python");
    expect(executor.supportedLanguages).toContain("javascript");
    expect(executor.supportedLanguages).toContain("typescript");
  });

  test("initialize resolves without error", async () => {
    const executor = makeExecutor(createMockClient());
    await expect(executor.initialize()).resolves.toBeUndefined();
  });

  test("dispose resolves without error", async () => {
    const executor = makeExecutor(createMockClient());
    await expect(executor.dispose()).resolves.toBeUndefined();
  });
});

// ─── execute — success paths ──────────────────────────────────────────────────

describe("AgentCoreExecutor — execute Python", () => {
  let client: ReturnType<typeof createMockClient>;
  beforeEach(() => {
    client = createMockClient({
      executeContent: { executionTime: 150, exitCode: 0, stderr: "", stdout: "42\n" },
    });
  });

  test("returns success=true and correct stdout", async () => {
    const result = await makeExecutor(client).execute({
      code: "print(6*7)",
      language: "python",
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("42\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("executionTimeMs comes from AgentCore executionTime field", async () => {
    const result = await makeExecutor(client).execute({
      code: "print(6*7)",
      language: "python",
    });
    expect(result.executionTimeMs).toBe(150);
  });
});

describe("AgentCoreExecutor — execute JavaScript", () => {
  test("returns success=true with stdout", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "hello from js" },
    });
    const result = await makeExecutor(client).execute({
      code: 'console.log("hello from js")',
      language: "javascript",
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("hello from js");
  });

  test("captures stderr independently", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "warning text", stdout: "" },
    });
    const result = await makeExecutor(client).execute({
      code: "process.stderr.write('warning text')",
      language: "javascript",
    });
    expect(result.stderr).toBe("warning text");
  });
});

describe("AgentCoreExecutor — execute TypeScript", () => {
  test("returns success=true", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "typed output" },
    });
    const result = await makeExecutor(client).execute({
      code: "const x: number = 42; console.log('typed output')",
      language: "typescript",
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("typed output");
  });
});

// ─── inputFiles → writeFiles ───────────────────────────────────────────────

describe("AgentCoreExecutor — inputFiles flow", () => {
  test("writeFiles invoked before executeCode when inputFiles provided", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "done" },
    });
    await makeExecutor(client).execute({
      code: "with open('input.txt') as f: print(f.read())",
      inputFiles: new Map([["input.txt", "staged content"]]),
      language: "python",
    });

    const writeIdx = client.send.mock.calls.findIndex(
      (args) => (args[0] as { input?: { name?: string } }).input?.name === "writeFiles"
    );
    const execIdx = client.send.mock.calls.findIndex(
      (args) => (args[0] as { input?: { name?: string } }).input?.name === "executeCode"
    );
    expect(writeIdx).toBeGreaterThanOrEqual(0);
    expect(execIdx).toBeGreaterThan(writeIdx);
  });

  test("exactly one writeFiles call per execute with inputFiles", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    await makeExecutor(client).execute({
      code: "pass",
      inputFiles: new Map([
        ["a.txt", "alpha"],
        ["b.txt", "beta"],
      ]),
      language: "python",
    });
    expect(client.invokeCallsFor("writeFiles")).toHaveLength(1);
  });

  test("no writeFiles call when no inputFiles provided", async () => {
    const client = createMockClient();
    await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(client.invokeCallsFor("writeFiles")).toHaveLength(0);
  });
});

// ─── outputFiles via listFiles → readFiles ────────────────────────────────

describe("AgentCoreExecutor — outputFiles collection", () => {
  test("listFiles always called after execution", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    await makeExecutor(client).execute({ code: "pass", language: "python" });
    expect(client.invokeCallsFor("listFiles")).toHaveLength(1);
  });

  test("readFiles called and outputFiles returned when listFiles has entries", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
      listFilesContent: { fileNames: ["output.txt"] },
      readFilesContent: { files: [{ content: "result data", name: "output.txt" }] },
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });

    expect(client.invokeCallsFor("readFiles")).toHaveLength(1);
    expect(result.outputFiles).toBeDefined();
    expect(result.outputFiles!.has("output.txt")).toBe(true);

    const decoded = new TextDecoder().decode(result.outputFiles!.get("output.txt"));
    expect(decoded).toBe("result data");
  });

  test("outputFiles is undefined when listFiles returns empty", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
      listFilesContent: {},
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    expect(result.outputFiles).toBeUndefined();
    expect(client.invokeCallsFor("readFiles")).toHaveLength(0);
  });

  test("input files excluded from outputFiles", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
      // AgentCore lists both the input and output files
      listFilesContent: { fileNames: ["input.txt", "output.txt"] },
      readFilesContent: { files: [{ content: "new data", name: "output.txt" }] },
    });
    const result = await makeExecutor(client).execute({
      code: "pass",
      inputFiles: new Map([["input.txt", "original"]]),
      language: "python",
    });

    expect(result.outputFiles?.has("input.txt")).toBeFalsy();
    expect(result.outputFiles?.has("output.txt")).toBe(true);
  });

  test("outputFiles values are Uint8Array", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
      listFilesContent: { fileNames: ["out.bin"] },
      readFilesContent: {
        files: [{ content: "AQID", encoding: "base64", name: "out.bin" }],
      },
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    expect(result.outputFiles?.get("out.bin")).toBeInstanceOf(Uint8Array);
  });
});

// ─── error handling ──────────────────────────────────────────────────────────

describe("AgentCoreExecutor — error handling", () => {
  test("AWS exception during StartSession → success: false", async () => {
    const client = createMockClient({
      startError: new Error("AccessDeniedException: not authorized"),
    });
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("AccessDeniedException");
    expect(result.executionTimeMs).toBe(0);
    expect(result.exitCode).toBe(1);
  });

  test("AWS exception during InvokeCodeInterpreter → success: false", async () => {
    const client = createMockClient({
      invokeError: new Error("InternalServerException: service failure"),
    });
    const result = await makeExecutor(client).execute({
      code: "raise Exception()",
      language: "python",
    });
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("InternalServerException");
  });

  test("non-zero exit code → success: false", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 2, stderr: "RuntimeError: boom", stdout: "" },
    });
    const result = await makeExecutor(client).execute({ code: "raise", language: "python" });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("RuntimeError");
  });

  test("AbortError (timeout simulation) → success: false", async () => {
    const abortErr = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    const client = createMockClient({ startError: abortErr });
    const result = await makeExecutor(client).execute({
      code: "print(1)",
      language: "python",
      timeoutMs: 1000,
    });
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("aborted");
  });
});

// ─── session cleanup (finally block) ─────────────────────────────────────────

describe("AgentCoreExecutor — session cleanup", () => {
  test("StopSession called on successful execution", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "ok" },
    });
    await makeExecutor(client).execute({ code: "print('ok')", language: "python" });
    expect(client.callsFor("StopCodeInterpreterSessionCommand")).toHaveLength(1);
  });

  test("StopSession called even when InvokeCodeInterpreter throws", async () => {
    const client = createMockClient({
      invokeError: new Error("Internal error"),
    });
    const result = await makeExecutor(client).execute({ code: "code", language: "python" });
    expect(result.success).toBe(false);
    expect(client.callsFor("StopCodeInterpreterSessionCommand")).toHaveLength(1);
  });

  test("StopSession NOT called when StartSession fails (no sessionId)", async () => {
    const client = createMockClient({
      startError: new Error("Session start failed"),
    });
    await makeExecutor(client).execute({ code: "code", language: "python" });
    // sessionId was never assigned, so finally block skips stop
    expect(client.callsFor("StopCodeInterpreterSessionCommand")).toHaveLength(0);
  });

  test("StopSession uses correct sessionId from StartSession response", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
      sessionId: "specific-session-xyz",
    });
    await makeExecutor(client).execute({ code: "pass", language: "python" });
    const stopCalls = client.callsFor("StopCodeInterpreterSessionCommand");
    expect(stopCalls).toHaveLength(1);
    const stopInput = (stopCalls[0]![0] as { input?: { sessionId?: string } }).input;
    expect(stopInput?.sessionId).toBe("specific-session-xyz");
  });

  test("each execute() starts and stops its own session", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    const executor = makeExecutor(client);
    await executor.execute({ code: "pass", language: "python" });
    await executor.execute({ code: "pass", language: "python" });

    expect(client.callsFor("StartCodeInterpreterSessionCommand")).toHaveLength(2);
    expect(client.callsFor("StopCodeInterpreterSessionCommand")).toHaveLength(2);
  });
});

// ─── timeout behaviour ────────────────────────────────────────────────────────

describe("AgentCoreExecutor — timeout", () => {
  test("AbortError from SDK propagates to failure ExecutionResult", async () => {
    const err = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const client = createMockClient({ startError: err });
    const executor = makeExecutor(client);
    const result = await executor.execute({
      code: "print(1)",
      language: "python",
      timeoutMs: 100,
    });
    expect(result.success).toBe(false);
    expect(typeof result.stderr).toBe("string");
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  test("timeout option is accepted without throwing", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "ok" },
    });
    const result = await makeExecutor(client).execute({
      code: "print('ok')",
      language: "python",
      timeoutMs: 30_000,
    });
    expect(result.success).toBe(true);
  });
});
