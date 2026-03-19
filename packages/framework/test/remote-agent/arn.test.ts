import { describe, expect, mock, test } from "bun:test";
import { RemoteAgentError } from "../../src/remote-agent/types";

function makeAwsError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

interface AwsClientConfig {
  region: string;
}
let capturedClientConfig: AwsClientConfig | undefined;
let capturedCommandInput: Record<string, unknown> | undefined;
let capturedSendOpts: { abortSignal?: AbortSignal } | undefined;
let sendBehavior: () => Promise<unknown> = async () => ({
  output: { transformToString: async () => "default response" },
});

mock.module("@aws-sdk/client-bedrock-agentcore", () => ({
  BedrockAgentCoreClient: class MockBedrockAgentCoreClient {
    constructor(config: AwsClientConfig) {
      capturedClientConfig = config;
    }
    async send(command: { input: Record<string, unknown> }, opts: { abortSignal?: AbortSignal }) {
      capturedCommandInput = command.input;
      capturedSendOpts = opts;
      return sendBehavior();
    }
  },
  InvokeAgentRuntimeCommand: class MockInvokeAgentRuntimeCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

function resetCaptures() {
  capturedClientConfig = undefined;
  capturedCommandInput = undefined;
  capturedSendOpts = undefined;
  sendBehavior = async () => ({
    output: { transformToString: async () => "default response" },
  });
}

async function callArn(overrides?: {
  arn?: string;
  region?: string;
  task?: string;
  timeout?: number;
}) {
  resetCaptures();
  const { callRemoteAgentArn } = await import("../../src/remote-agent/http");
  return callRemoteAgentArn(
    "test-agent",
    {
      arn: overrides?.arn ?? "arn:aws:bedrock:us-east-1:123456789:agent/TestAgent",
      region: overrides?.region,
      timeout: overrides?.timeout,
    },
    overrides?.task ?? "do something"
  );
}

async function callArnWithBehavior(
  behavior: () => Promise<unknown>,
  overrides?: { arn?: string; region?: string; task?: string; timeout?: number }
) {
  resetCaptures();
  sendBehavior = behavior;
  const { callRemoteAgentArn } = await import("../../src/remote-agent/http");
  return callRemoteAgentArn(
    "test-agent",
    {
      arn: overrides?.arn ?? "arn:aws:bedrock:us-east-1:123456789:agent/TestAgent",
      region: overrides?.region,
      timeout: overrides?.timeout,
    },
    overrides?.task ?? "do something"
  );
}

describe("callRemoteAgentArn()", () => {
  test("sends InvokeAgentRuntimeCommand with correct params", async () => {
    const result = await callArn({ task: "scan target" });

    expect(result).toBe("default response");
    expect(capturedCommandInput.agentRuntimeArn).toBe(
      "arn:aws:bedrock:us-east-1:123456789:agent/TestAgent"
    );
    const payload = JSON.parse(new TextDecoder().decode(capturedCommandInput.payload));
    expect(payload.task).toBe("scan target");
    expect(capturedCommandInput.contentType).toBe("application/json");
    expect(capturedCommandInput.accept).toBe("application/json");
    expect(capturedSendOpts.abortSignal).toBeDefined();
  });

  test("generates session ID with ≥33 chars starting with session-", async () => {
    await callArn();

    expect(capturedCommandInput.runtimeSessionId).toBeDefined();
    expect(capturedCommandInput.runtimeSessionId.startsWith("session-")).toBe(true);
    expect(capturedCommandInput.runtimeSessionId.length).toBeGreaterThanOrEqual(33);
  });

  test("uses default region us-east-1", async () => {
    await callArn();
    expect(capturedClientConfig.region).toBe("us-east-1");
  });

  test("uses custom region when specified", async () => {
    await callArn({ region: "eu-west-1" });
    expect(capturedClientConfig.region).toBe("eu-west-1");
  });

  test("returns text from transformToString", async () => {
    const result = await callArnWithBehavior(async () => ({
      output: { transformToString: async () => "streamed response" },
    }));
    expect(result).toBe("streamed response");
  });

  test("falls back to async iterator when transformToString unavailable", async () => {
    const result = await callArnWithBehavior(async () => ({
      output: {
        [Symbol.asyncIterator]: async function* () {
          yield new TextEncoder().encode("chunk1");
          yield new TextEncoder().encode("chunk2");
        },
      },
    }));

    expect(result).toBe("chunk1chunk2");
  });

  test("throws RemoteAgentError on empty transformToString response", async () => {
    await expect(
      callArnWithBehavior(async () => ({
        output: { transformToString: async () => "" },
      }))
    ).rejects.toThrow(RemoteAgentError);

    await expect(
      callArnWithBehavior(async () => ({
        output: { transformToString: async () => "" },
      }))
    ).rejects.toThrow(/Empty response/);
  });

  test("throws RemoteAgentError when output is null", async () => {
    await expect(callArnWithBehavior(async () => ({ output: null }))).rejects.toThrow(
      RemoteAgentError
    );

    await expect(callArnWithBehavior(async () => ({ output: null }))).rejects.toThrow(/No output/);
  });

  test("maps AccessDeniedException to descriptive error", async () => {
    await expect(
      callArnWithBehavior(async () => {
        throw makeAwsError("AccessDeniedException", "not authorized");
      })
    ).rejects.toThrow(/Access denied: check IAM permissions/);
  });

  test("maps ResourceNotFoundException to descriptive error", async () => {
    await expect(
      callArnWithBehavior(async () => {
        throw makeAwsError("ResourceNotFoundException", "agent not found");
      })
    ).rejects.toThrow(/Agent not found: verify ARN/);
  });

  test("maps ThrottlingException to descriptive error", async () => {
    await expect(
      callArnWithBehavior(async () => {
        throw makeAwsError("ThrottlingException", "too many requests");
      })
    ).rejects.toThrow(/Rate limited: retry after delay/);
  });

  test("maps unknown AWS errors with original message", async () => {
    await expect(
      callArnWithBehavior(async () => {
        throw makeAwsError("ValidationException", "bad input");
      })
    ).rejects.toThrow(/AWS SDK error: bad input/);
  });

  test("wraps timeout errors", async () => {
    await expect(
      callArnWithBehavior(async () => {
        const err = new Error("aborted");
        err.name = "TimeoutError";
        throw err;
      })
    ).rejects.toThrow(/timed out/);
  });

  test("preserves cause in RemoteAgentError", async () => {
    const original = makeAwsError("AccessDeniedException", "forbidden");

    try {
      await callArnWithBehavior(async () => {
        throw original;
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteAgentError);
      expect((error as RemoteAgentError).cause).toBe(original);
    }
  });

  test("all errors are RemoteAgentError instances", async () => {
    for (const name of [
      "AccessDeniedException",
      "ResourceNotFoundException",
      "ThrottlingException",
      "ValidationException",
    ]) {
      await expect(
        callArnWithBehavior(async () => {
          throw makeAwsError(name, "test");
        })
      ).rejects.toBeInstanceOf(RemoteAgentError);
    }
  });

  test("agentName is included in error message", async () => {
    await expect(
      callArnWithBehavior(async () => {
        throw makeAwsError("AccessDeniedException", "denied");
      })
    ).rejects.toThrow(/test-agent/);
  });
});
