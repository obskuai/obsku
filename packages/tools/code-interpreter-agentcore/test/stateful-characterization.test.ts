import { describe, expect, test } from "bun:test";
import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { buildCodeInterpreterPlugin } from "@obsku/tool-code-interpreter/plugin-builder";
import { Effect } from "effect";
import { AgentCoreExecutor } from "../src/executor";
import { AgentCoreSessionManager } from "../src/session-manager";
import { createMockClient } from "./mocks";

type PluginResult = { isError?: boolean; result: string };

function createHarness() {
  const client = createMockClient({
    executeContent: { executionTime: 25, exitCode: 0, stderr: "", stdout: "ok" },
  });
  const typedClient = client as unknown as BedrockAgentCoreClient;
  const sessionManager = new AgentCoreSessionManager(
    "us-east-1",
    "aws.codeinterpreter.v1",
    typedClient
  );
  const plugin = buildCodeInterpreterPlugin({
    description: "test",
    executor: new AgentCoreExecutor({ client: typedClient, region: "us-east-1" }),
    securityWarning: "test",
    sessionManager,
  });

  return {
    client,
    plugin,
    sessionManager,
  };
}

async function runPlugin(
  plugin: ReturnType<typeof buildCodeInterpreterPlugin>,
  input: Record<string, unknown>
): Promise<PluginResult> {
  return Effect.runPromise(plugin.execute(input)) as Promise<PluginResult>;
}

function executeCodeLanguage(client: ReturnType<typeof createMockClient>): string | undefined {
  const call = client.invokeCallsFor("executeCode")[0];
  const input = call?.[0] as { input?: { arguments?: { language?: string } } } | undefined;
  return input?.input?.arguments?.language;
}

function executeCodeAbortSignal(
  client: ReturnType<typeof createMockClient>
): AbortSignal | undefined {
  const call = client.invokeCallsFor("executeCode")[0];
  const options = call?.[1] as { abortSignal?: AbortSignal } | undefined;
  return options?.abortSignal;
}

describe("AgentCore plugin stateful/stateless characterization", () => {
  test("stateful inputFiles characterization expects sessionId path to upload files like stateless execution", async () => {
    const stateless = createHarness();
    await runPlugin(stateless.plugin, {
      code: "print('ok')",
      inputFiles: { "input.txt": "hello" },
      language: "python",
    });
    expect(stateless.client.invokeCallsFor("writeFiles")).toHaveLength(1);

    const stateful = createHarness();
    const sessionId = stateful.sessionManager.create("python");

    try {
      await runPlugin(stateful.plugin, {
        code: "print('ok')",
        inputFiles: { "input.txt": "hello" },
        language: "python",
        sessionId,
      });

      expect(stateful.client.invokeCallsFor("writeFiles")).toHaveLength(1);
    } finally {
      await stateful.sessionManager.destroyAll();
    }
  });

  test("stateful timeout characterization expects sessionId path to forward timeout-derived abort signal", async () => {
    const stateless = createHarness();
    await runPlugin(stateless.plugin, {
      code: "print('ok')",
      language: "python",
      timeoutMs: 25,
    });
    expect(executeCodeAbortSignal(stateless.client)).toBeInstanceOf(AbortSignal);

    const stateful = createHarness();
    const sessionId = stateful.sessionManager.create("python");

    try {
      await runPlugin(stateful.plugin, {
        code: "print('ok')",
        language: "python",
        sessionId,
        timeoutMs: 25,
      });

      expect(executeCodeAbortSignal(stateful.client)).toBeInstanceOf(AbortSignal);
    } finally {
      await stateful.sessionManager.destroyAll();
    }
  });

  test("stateful language characterization expects sessionId path to forward requested language", async () => {
    const stateless = createHarness();
    await runPlugin(stateless.plugin, {
      code: "console.log('ok')",
      language: "javascript",
    });
    expect(executeCodeLanguage(stateless.client)).toBe("javascript");

    const stateful = createHarness();
    const sessionId = stateful.sessionManager.create("python");

    try {
      await runPlugin(stateful.plugin, {
        code: "console.log('ok')",
        language: "javascript",
        sessionId,
      });

      expect(executeCodeLanguage(stateful.client)).toBe("javascript");
    } finally {
      await stateful.sessionManager.destroyAll();
    }
  });
});
