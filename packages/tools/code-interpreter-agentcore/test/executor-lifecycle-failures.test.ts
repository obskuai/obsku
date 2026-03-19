/**
 * Characterization tests: AgentCore executor lifecycle failures.
 *
 * Covers each lifecycle stage and pins the observable behavior
 * (stderr, exitCode, success, stdout, cleanup) without altering
 * any existing logic.
 *
 * Lifecycle stages:
 *   1. startSession   — StartCodeInterpreterSessionCommand
 *   2. executeCode    — InvokeCodeInterpreterCommand
 *   3. parse          — collectStructuredContent (stream → StructuredContent)
 *   4. upload (S3)    — S3Uploader.uploadResult
 *   5. stopSession    — StopCodeInterpreterSessionCommand (finally block)
 */

import { describe, expect, mock, test } from "bun:test";
import type {
  BedrockAgentCoreClient,
  CodeInterpreterStreamOutput,
} from "@aws-sdk/client-bedrock-agentcore";
import {
  InvokeCodeInterpreterCommand,
  StartCodeInterpreterSessionCommand,
  StopCodeInterpreterSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { AgentCoreExecutor } from "../src/executor";
import { S3Uploader } from "../src/s3-uploader";
import type { AgentCoreExecutionResult } from "../src/types";
import { createMockClient } from "./mocks";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeExecutor(
  client: ReturnType<typeof createMockClient> | ReturnType<typeof makeParseFailureMockClient>,
  options: { s3Upload?: { bucket: string; prefix?: string; region?: string } } = {}
): AgentCoreExecutor {
  return new AgentCoreExecutor({
    client: client as unknown as BedrockAgentCoreClient,
    region: "us-east-1",
    ...options,
  });
}

/**
 * Stream that yields an event with no recognisable structuredContent shape.
 * collectStructuredContent will skip every item → returns undefined.
 */
function createUnparsableStream(): AsyncIterable<CodeInterpreterStreamOutput> {
  return {
    [Symbol.asyncIterator]() {
      let done = false;
      return {
        next(): Promise<IteratorResult<CodeInterpreterStreamOutput>> {
          if (done) {
            return Promise.resolve({
              done: true as const,
              value: undefined as unknown as CodeInterpreterStreamOutput,
            });
          }
          done = true;
          return Promise.resolve({
            done: false,
            // Does NOT contain result.structuredContent → extractStructuredContent returns undefined
            value: {
              unknownShape: { raw: "corrupted payload" },
            } as unknown as CodeInterpreterStreamOutput,
          });
        },
      };
    },
  };
}

/**
 * Mock client that returns unparsable streams for every InvokeCodeInterpreter call.
 * Used to simulate stage-3 (parse) failure.
 */
function makeParseFailureMockClient() {
  const send = mock(async (command: unknown) => {
    if (
      (command as { constructor?: { name?: string } }).constructor?.name ===
      StartCodeInterpreterSessionCommand.name
    ) {
      return { sessionId: "parse-fail-session-id" };
    }
    if (
      (command as { constructor?: { name?: string } }).constructor?.name ===
      InvokeCodeInterpreterCommand.name
    ) {
      return { stream: createUnparsableStream() };
    }
    if (
      (command as { constructor?: { name?: string } }).constructor?.name ===
      StopCodeInterpreterSessionCommand.name
    ) {
      return {};
    }
    return {};
  });

  const destroy = mock(() => {});

  function callsFor(commandType: string) {
    return send.mock.calls.filter(
      (args) => (args[0] as { constructor: { name: string } }).constructor.name === commandType
    );
  }

  function invokeCallsFor(toolName: string) {
    return send.mock.calls.filter(
      (args) =>
        (args[0] as { constructor?: { name?: string } }).constructor?.name ===
          InvokeCodeInterpreterCommand.name &&
        (args[0] as { input?: { name?: string } }).input?.name === toolName
    );
  }

  return { callsFor, destroy, invokeCallsFor, send };
}

// ─── 1. Start failure ─────────────────────────────────────────────────────────

describe("lifecycle failure — stage 1: start", () => {
  test("success=false and exitCode=1 when StartSession throws", async () => {
    const client = createMockClient({ startError: new Error("ServiceUnavailableException") });
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  test("stderr contains the thrown error message", async () => {
    const client = createMockClient({
      startError: new Error("ServiceUnavailableException: bedrock down"),
    });
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.stderr).toContain("ServiceUnavailableException");
  });

  test("stdout is empty on start failure", async () => {
    const client = createMockClient({ startError: new Error("StartFailed") });
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.stdout).toBe("");
  });

  test("executionTimeMs is 0 on start failure (catch block hard-codes 0)", async () => {
    const client = createMockClient({ startError: new Error("StartFailed") });
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.executionTimeMs).toBe(0);
  });

  test("StopSession is NOT called — sessionId was never assigned", async () => {
    const client = createMockClient({ startError: new Error("StartFailed") });
    await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(client.callsFor("StopCodeInterpreterSessionCommand")).toHaveLength(0);
  });

  test("outputFiles is absent from result (not set in catch block)", async () => {
    const client = createMockClient({ startError: new Error("StartFailed") });
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.outputFiles).toBeUndefined();
  });
});

// ─── 2. Execute failure ────────────────────────────────────────────────────────

describe("lifecycle failure — stage 2: execute (invoke)", () => {
  test("success=false and exitCode=1 when InvokeCodeInterpreter throws", async () => {
    const client = createMockClient({ invokeError: new Error("ThrottlingException") });
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  test("stderr contains error message from invoke failure", async () => {
    const client = createMockClient({
      invokeError: new Error("ThrottlingException: rate exceeded"),
    });
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.stderr).toContain("ThrottlingException");
  });

  test("executionTimeMs is 0 on execute failure (catch block hard-codes 0)", async () => {
    const client = createMockClient({ invokeError: new Error("ThrottlingException") });
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.executionTimeMs).toBe(0);
  });

  test("stdout is empty on execute failure", async () => {
    const client = createMockClient({ invokeError: new Error("ThrottlingException") });
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.stdout).toBe("");
  });

  test("StopSession IS called despite execute failure (finally always runs)", async () => {
    const client = createMockClient({ invokeError: new Error("ThrottlingException") });
    await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(client.callsFor("StopCodeInterpreterSessionCommand")).toHaveLength(1);
  });

  test("StartSession IS called (sessionId exists) before execute throws", async () => {
    const client = createMockClient({ invokeError: new Error("ThrottlingException") });
    await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(client.callsFor("StartCodeInterpreterSessionCommand")).toHaveLength(1);
  });
});

// ─── 3. Parse failure ─────────────────────────────────────────────────────────
// Stream yields events with no recognisable structuredContent.
// collectStructuredContent returns undefined → execContent is undefined.

describe("lifecycle failure — stage 3: parse (unparsable stream)", () => {
  test("exitCode is undefined when stream yields no structured content", async () => {
    const client = makeParseFailureMockClient();
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.exitCode).toBeUndefined();
  });

  test("success=false when exitCode is undefined (undefined !== 0)", async () => {
    const client = makeParseFailureMockClient();
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.success).toBe(false);
  });

  test("stderr='' on parse failure (falls back to execContent?.stderr ?? '')", async () => {
    const client = makeParseFailureMockClient();
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.stderr).toBe("");
  });

  test("stdout='' on parse failure (falls back to execContent?.stdout ?? '')", async () => {
    const client = makeParseFailureMockClient();
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.stdout).toBe("");
  });

  test("executionTimeMs is wall-clock measured (not from content, which is undefined)", async () => {
    const client = makeParseFailureMockClient();
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    // fetchAndParseOutputs: Date.now() - startedAt when execContent?.executionTime is not a number
    expect(typeof result.executionTimeMs).toBe("number");
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  test("StopSession IS called after parse failure (finally always runs)", async () => {
    const client = makeParseFailureMockClient();
    await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(client.callsFor("StopCodeInterpreterSessionCommand")).toHaveLength(1);
  });

  test("execute() does not throw on parse failure — returns ExecutionResult", async () => {
    const client = makeParseFailureMockClient();
    const result = makeExecutor(client).execute({ code: "print(1)", language: "python" });
    await expect(result).resolves.toBeDefined();
  });
});

// ─── 4. Upload failure (S3) ───────────────────────────────────────────────────
// S3Uploader.uploadResult catches errors from upload() and appends
// "[S3 Upload Error]" to stdout without throwing.

describe("lifecycle failure — stage 4: S3 upload", () => {
  function makeFailingS3Uploader(errorMsg: string): S3Uploader {
    const uploader = new S3Uploader({ bucket: "test-bucket", region: "us-east-1" });
    // Replace private S3Client with one that always throws
    (uploader as unknown as { client: { send: () => Promise<never> } }).client = {
      send: async () => {
        throw new Error(errorMsg);
      },
    };
    return uploader;
  }

  test("stdout contains '[S3 Upload Error]' when upload fails", async () => {
    const uploader = makeFailingS3Uploader("S3ConnectionError: bucket not found");
    const fakeResult = {
      executionTimeMs: 100,
      exitCode: 0 as number | undefined,
      outputFiles: undefined as Map<string, Uint8Array> | undefined,
      stderr: "",
      stdout: "exec output",
      success: true,
    };
    const result = await uploader.uploadResult(fakeResult, "session-id");
    expect(result.stdout).toContain("[S3 Upload Error]");
    expect(result.stdout).toContain("S3ConnectionError");
  });

  test("original stdout is preserved before the [S3 Upload Error] suffix", async () => {
    const uploader = makeFailingS3Uploader("NoSuchBucket");
    const fakeResult = {
      executionTimeMs: 50,
      exitCode: 0 as number | undefined,
      outputFiles: undefined as Map<string, Uint8Array> | undefined,
      stderr: "",
      stdout: "the original output",
      success: true,
    };
    const result = await uploader.uploadResult(fakeResult, "session-xyz");
    expect(result.stdout).toContain("the original output");
    expect(result.stdout).toContain("[S3 Upload Error]");
  });

  test("success/exitCode/executionTimeMs/stderr unchanged after upload failure", async () => {
    const uploader = makeFailingS3Uploader("S3 network timeout");
    const fakeResult = {
      executionTimeMs: 200,
      exitCode: 0 as number | undefined,
      outputFiles: undefined as Map<string, Uint8Array> | undefined,
      stderr: "",
      stdout: "output data",
      success: true,
    };
    const result = await uploader.uploadResult(fakeResult, "session-abc");
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.executionTimeMs).toBe(200);
    expect(result.stderr).toBe("");
  });

  test("uploadResult never throws — returns even when S3 is unavailable", async () => {
    const uploader = makeFailingS3Uploader("Connection refused");
    const fakeResult = {
      executionTimeMs: 0,
      exitCode: 1 as number | undefined,
      outputFiles: undefined as Map<string, Uint8Array> | undefined,
      stderr: "runtime error",
      stdout: "",
      success: false,
    };
    await expect(uploader.uploadResult(fakeResult, "session-err")).resolves.toBeDefined();
  });

  test("failed upload result preserves failed-execution fields intact", async () => {
    const uploader = makeFailingS3Uploader("S3 down");
    const fakeResult = {
      executionTimeMs: 50,
      exitCode: 2 as number | undefined,
      outputFiles: undefined as Map<string, Uint8Array> | undefined,
      stderr: "RuntimeError: boom",
      stdout: "",
      success: false,
    };
    const result = await uploader.uploadResult(fakeResult, "s");
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("RuntimeError: boom");
  });
});

// ─── 5. Stop-session failure (cleanup) ────────────────────────────────────────
// stopSession wraps StopSession in try/catch → errors are swallowed via
// telemetryLog. The execution result is never affected by cleanup failure.

describe("lifecycle failure — stage 5: stop-session (cleanup)", () => {
  test("execution result is unchanged when StopSession throws", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "success output" },
      stopError: new Error("StopSessionFailed: cleanup error"),
    });
    const result = await makeExecutor(client).execute({ code: "print('ok')", language: "python" });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("success output");
    expect(result.stderr).toBe("");
  });

  test("execute() resolves (does not throw) when StopSession throws", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
      stopError: new Error("CleanupFailed"),
    });
    await expect(
      makeExecutor(client).execute({ code: "pass", language: "python" })
    ).resolves.toBeDefined();
  });

  test("failed-execution result also unchanged when StopSession throws", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 1, stderr: "RuntimeError: boom", stdout: "" },
      stopError: new Error("CleanupFailed"),
    });
    const result = await makeExecutor(client).execute({
      code: "raise Exception()",
      language: "python",
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("RuntimeError");
  });

  test("StopSession is attempted exactly once even when it throws", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
      stopError: new Error("stop failed"),
    });
    await makeExecutor(client).execute({ code: "pass", language: "python" });
    // The call is recorded by the mock before the throw propagates inside stopSession
    expect(client.callsFor("StopCodeInterpreterSessionCommand")).toHaveLength(1);
  });

  test("executionTimeMs is not zero on stop failure (from content, not catch block)", async () => {
    const client = createMockClient({
      executeContent: { executionTime: 300, exitCode: 0, stderr: "", stdout: "" },
      stopError: new Error("stop failed"),
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    // executionTimeMs comes from AgentCore executionTime field — not the catch block's 0
    expect(result.executionTimeMs).toBe(300);
  });

  test("cleanup failure is observable via cleanupError field — primary result fields unchanged", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "normal" },
      stopError: new Error("CleanupError: session expired"),
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    expect(result.stderr).not.toContain("CleanupError");
    expect(result.stdout).not.toContain("CleanupError");
    expect(result.exitCode).toBe(0);
    expect(result.success).toBe(true);
  });

  test("cleanupError is set when StopSession throws", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "ok" },
      stopError: new Error("StopSessionFailed: cleanup error"),
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    expect(result.cleanupError).toBeDefined();
    expect(result.cleanupError).toContain("StopSessionFailed");
  });

  test("cleanupError is undefined when StopSession succeeds", async () => {
    const client = createMockClient({ executeContent: { exitCode: 0, stderr: "", stdout: "" } });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    expect(result.cleanupError).toBeUndefined();
  });

  test("primary result success=true, exitCode=0 unchanged alongside cleanupError", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "output" },
      stopError: new Error("cleanup boom"),
    });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.cleanupError).toBeDefined();
  });
});

describe("stage-aware error context", () => {
  test("failedStage is 'startSession' when StartSession throws", async () => {
    const client = createMockClient({ startError: new Error("StartFailed") });
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect((result as AgentCoreExecutionResult).failedStage).toBe("startSession");
  });

  test("failedStage is 'execute' when InvokeCodeInterpreter throws (no inputFiles)", async () => {
    const client = createMockClient({ invokeError: new Error("ThrottlingException") });
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect((result as AgentCoreExecutionResult).failedStage).toBe("execute");
  });

  test("failedStage is 'uploadCode' when InvokeCodeInterpreter throws during writeFiles", async () => {
    const client = createMockClient({ invokeError: new Error("WriteFilesError") });
    const inputFiles = new Map([["input.txt", "hello"]]);
    const result = await makeExecutor(client).execute({
      code: "pass",
      inputFiles,
      language: "python",
    });
    expect((result as AgentCoreExecutionResult).failedStage).toBe("uploadInputFiles");
  });

  test("failedStage is undefined for successful execution", async () => {
    const client = createMockClient({ executeContent: { exitCode: 0, stderr: "", stdout: "" } });
    const result = await makeExecutor(client).execute({ code: "pass", language: "python" });
    expect((result as AgentCoreExecutionResult).failedStage).toBeUndefined();
  });

  test("failedStage is undefined for parse failure (no throw, undefined execContent)", async () => {
    const client = makeParseFailureMockClient();
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect((result as AgentCoreExecutionResult).failedStage).toBeUndefined();
  });

  test("stage failure still sets exitCode=1 and success=false", async () => {
    const client = createMockClient({ startError: new Error("StartFailed") });
    const result = await makeExecutor(client).execute({ code: "print(1)", language: "python" });
    expect(result.exitCode).toBe(1);
    expect(result.success).toBe(false);
  });
});
