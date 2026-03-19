import { describe, expect, test } from "bun:test";
import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { AgentCoreSessionManager } from "../src/session-manager";
import { createMockClient } from "./mocks";

const DEFAULT_CI_ID = "aws.codeinterpreter.v1";

function makeManager(
  client: ReturnType<typeof createMockClient>,
  ciId = DEFAULT_CI_ID
): AgentCoreSessionManager {
  return new AgentCoreSessionManager(
    "us-east-1",
    ciId,
    client as unknown as BedrockAgentCoreClient
  );
}

// ─── create ──────────────────────────────────────────────────────────────────

describe("AgentCoreSessionManager — create()", () => {
  test("returns a non-empty string session ID", () => {
    const client = createMockClient();
    const manager = makeManager(client);
    const id = manager.create("python");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("IDs are unique across multiple create() calls", () => {
    const client = createMockClient();
    const manager = makeManager(client);
    const ids = new Set([
      manager.create("python"),
      manager.create("javascript"),
      manager.create("typescript"),
    ]);
    expect(ids.size).toBe(3);
  });

  test("StartCodeInterpreterSession is called after create() + execute()", async () => {
    const client = createMockClient({ sessionId: "agentcore-session-abc" });
    const manager = makeManager(client);

    const id = manager.create("python");
    // execute() awaits session.init, so Start must have been called by now
    await manager.execute(id, "x = 1");

    expect(client.callsFor("StartCodeInterpreterSessionCommand")).toHaveLength(1);
  });

  test("StartCodeInterpreterSession uses correct codeInterpreterIdentifier", async () => {
    const ciId = "custom.ci.identifier";
    const client = createMockClient();
    const manager = makeManager(client, ciId);

    const id = manager.create("python");
    await manager.execute(id, "pass");

    const startCalls = client.callsFor("StartCodeInterpreterSessionCommand");
    const startInput = (startCalls[0]![0] as { input?: { codeInterpreterIdentifier?: string } })
      .input;
    expect(startInput?.codeInterpreterIdentifier).toBe(ciId);
  });

  test("sessionTimeoutSeconds derived from maxDurationMs", async () => {
    const client = createMockClient();
    const manager = makeManager(client);

    const id = manager.create("python", { maxDurationMs: 60_000 });
    await manager.execute(id, "pass");

    const startCalls = client.callsFor("StartCodeInterpreterSessionCommand");
    const startInput = (startCalls[0]![0] as { input?: { sessionTimeoutSeconds?: number } }).input;
    expect(startInput?.sessionTimeoutSeconds).toBe(60); // 60000 ms / 1000
  });
});

// ─── execute ──────────────────────────────────────────────────────────────────

describe("AgentCoreSessionManager — execute()", () => {
  test("returns ExecutionResult with correct shape on success", async () => {
    const client = createMockClient({
      executeContent: { executionTime: 80, exitCode: 0, stderr: "", stdout: "hello\n" },
    });
    const manager = makeManager(client);
    const id = manager.create("python");
    const result = await manager.execute(id, "print('hello')");

    expect(result.success).toBe(true);
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(typeof result.executionTimeMs).toBe("number");
  });

  test("calls InvokeCodeInterpreter with executeCode", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    const manager = makeManager(client);
    const id = manager.create("python");
    await manager.execute(id, "x = 42");

    expect(client.invokeCallsFor("executeCode")).toHaveLength(1);
  });

  test("uses the AgentCore sessionId returned by StartSession", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
      sessionId: "ac-session-999",
    });
    const manager = makeManager(client);
    const id = manager.create("python");
    await manager.execute(id, "pass");

    const invokeCalls = client.callsFor("InvokeCodeInterpreterCommand");
    const invokeInput = (invokeCalls[0]![0] as { input?: { sessionId?: string } }).input;
    expect(invokeInput?.sessionId).toBe("ac-session-999");
  });

  test("multiple execute() calls reuse same AgentCore sessionId", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
      sessionId: "persistent-session-42",
    });
    const manager = makeManager(client);
    const id = manager.create("python");

    await manager.execute(id, "x = 42");
    await manager.execute(id, "print(x)");

    const invokeCalls = client.callsFor("InvokeCodeInterpreterCommand");
    expect(invokeCalls).toHaveLength(2);
    for (const call of invokeCalls) {
      const input = (call[0] as { input?: { sessionId?: string } }).input;
      expect(input?.sessionId).toBe("persistent-session-42");
    }
  });

  test("error result for unknown session ID", async () => {
    const client = createMockClient();
    const manager = makeManager(client);
    const result = await manager.execute("nonexistent-id", "code");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("not found");
  });

  test("non-zero exit code → success: false", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 1, stderr: "RuntimeError", stdout: "" },
    });
    const manager = makeManager(client);
    const id = manager.create("python");
    const result = await manager.execute(id, "raise RuntimeError()");

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("RuntimeError");
  });

  test("AWS error in invoke → wraps to failure result", async () => {
    const client = createMockClient({
      invokeError: new Error("ThrottlingException: rate exceeded"),
    });
    const manager = makeManager(client);
    const id = manager.create("python");
    const result = await manager.execute(id, "code");

    expect(result.success).toBe(false);
    expect(result.stderr).toContain("ThrottlingException");
  });
});

// ─── destroy ─────────────────────────────────────────────────────────────────

describe("AgentCoreSessionManager — destroy()", () => {
  test("calls StopCodeInterpreterSession after execute", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    const manager = makeManager(client);
    const id = manager.create("python");
    await manager.execute(id, "pass");
    await manager.destroy(id);

    expect(client.callsFor("StopCodeInterpreterSessionCommand")).toHaveLength(1);
  });

  test("stops correct AgentCore session", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
      sessionId: "target-session-77",
    });
    const manager = makeManager(client);
    const id = manager.create("python");
    await manager.execute(id, "pass");
    await manager.destroy(id);

    const stopCalls = client.callsFor("StopCodeInterpreterSessionCommand");
    expect(stopCalls).toHaveLength(1);
    const stopInput = (stopCalls[0]![0] as { input?: { sessionId?: string } }).input;
    expect(stopInput?.sessionId).toBe("target-session-77");
  });

  test("is idempotent — double destroy is safe", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    const manager = makeManager(client);
    const id = manager.create("python");
    await manager.execute(id, "pass");

    await manager.destroy(id);
    await expect(manager.destroy(id)).resolves.toBeUndefined();
    // Stop called only once (second destroy finds no session record)
    expect(client.callsFor("StopCodeInterpreterSessionCommand")).toHaveLength(1);
  });

  test("subsequent execute() returns not-found after destroy", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    const manager = makeManager(client);
    const id = manager.create("python");
    await manager.execute(id, "pass");
    await manager.destroy(id);

    const result = await manager.execute(id, "more code");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("not found");
  });
});

// ─── destroyAll ───────────────────────────────────────────────────────────────

describe("AgentCoreSessionManager — destroyAll()", () => {
  test("stops all active sessions", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    const manager = makeManager(client);

    const id1 = manager.create("python");
    const id2 = manager.create("javascript");
    const id3 = manager.create("typescript");

    // Ensure inits run before destroy
    await manager.execute(id1, "pass");
    await manager.execute(id2, "pass");
    await manager.execute(id3, "pass");

    await manager.destroyAll();

    expect(client.callsFor("StopCodeInterpreterSessionCommand")).toHaveLength(3);
  });

  test("all sessions become unreachable after destroyAll", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    const manager = makeManager(client);

    const id1 = manager.create("python");
    const id2 = manager.create("javascript");

    await manager.execute(id1, "pass");
    await manager.execute(id2, "pass");
    await manager.destroyAll();

    expect((await manager.execute(id1, "x")).success).toBe(false);
    expect((await manager.execute(id2, "x")).success).toBe(false);
  });

  test("destroyAll on empty manager resolves safely", async () => {
    const client = createMockClient();
    const manager = makeManager(client);
    await expect(manager.destroyAll()).resolves.toBeUndefined();
    expect(client.callsFor("StopCodeInterpreterSessionCommand")).toHaveLength(0);
  });

  test("allows new sessions after destroyAll", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    const manager = makeManager(client);
    manager.create("python");
    await manager.destroyAll();

    // Should not throw
    const newId = manager.create("javascript");
    expect(typeof newId).toBe("string");
  });
});

// ─── session error paths ──────────────────────────────────────────────────────

describe("AgentCoreSessionManager — session error paths", () => {
  test("StartSession failure causes execute() to reject (init error propagates)", async () => {
    const client = createMockClient({
      startError: new Error("AccessDeniedException: unauthorized"),
    });
    const manager = makeManager(client);
    const id = manager.create("python");
    // base-session-manager does NOT wrap session.init in try/catch,
    // so initializeSession() failures propagate out of execute().
    await expect(manager.execute(id, "code")).rejects.toThrow("AccessDeniedException");
  });

  test("max duration exceeded → error result", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    const manager = makeManager(client);
    // maxDurationMs: -1 means already exceeded at creation time
    const id = manager.create("python", { maxDurationMs: -1 });
    await manager.execute(id, "pass"); // init completes
    const result = await manager.execute(id, "more code");

    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/max duration|not found/i);
  });

  test("idle timeout exceeded → error result", async () => {
    const client = createMockClient({
      executeContent: { exitCode: 0, stderr: "", stdout: "" },
    });
    const manager = makeManager(client);
    const id = manager.create("python", { idleTimeoutMs: -1 });
    await manager.execute(id, "pass"); // init completes
    const result = await manager.execute(id, "more code");

    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/idle timeout|not found/i);
  });
});
