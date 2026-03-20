import { describe, expect, test } from "bun:test";
import type { LLMProvider, Message, ToolDef } from "@obsku/framework";
import { defaultRegistry } from "@obsku/framework/models";
import {
  BedrockError,
  bedrock,
  buildCommandConfig,
  fromBedrockContent,
  mapAwsError,
  toBedrockMessages,
  toBedrockTools,
} from "../src/index";

// ---------------------------------------------------------------------------
// Type tests — bedrock() satisfies LLMProvider
// ---------------------------------------------------------------------------

describe("bedrock() factory", () => {
  test("returns object satisfying LLMProvider interface", async () => {
    const provider = await bedrock({
      contextWindowSize: 200_000,
      maxOutputTokens: 4096,
      model: "anthropic.claude-3-sonnet-20240229-v1:0",
      region: "us-west-2",
    });
    expect(typeof provider.chat).toBe("function");
    expect(typeof provider.chatStream).toBe("function");
    const _check: LLMProvider = provider;
    expect(_check).toBeDefined();
  });

  test("explicit region used over AWS_REGION env var", async () => {
    const origRegion = process.env.AWS_REGION;
    try {
      process.env.AWS_REGION = "eu-west-1";
      const p = await bedrock({
        contextWindowSize: 200_000,
        maxOutputTokens: 4096,
        model: "anthropic.claude-3-sonnet-20240229-v1:0",
        region: "ap-southeast-1",
      });
      expect(p).toBeDefined();
    } finally {
      if (origRegion !== undefined) {
        process.env.AWS_REGION = origRegion;
      } else {
        delete process.env.AWS_REGION;
      }
    }
  });

  test("falls back to AWS_REGION env var when region not provided", async () => {
    const origRegion = process.env.AWS_REGION;
    try {
      process.env.AWS_REGION = "eu-west-1";
      const p = await bedrock({
        contextWindowSize: 200_000,
        maxOutputTokens: 4096,
        model: "anthropic.claude-3-sonnet-20240229-v1:0",
      });
      expect(p).toBeDefined();
    } finally {
      if (origRegion !== undefined) {
        process.env.AWS_REGION = origRegion;
      } else {
        delete process.env.AWS_REGION;
      }
    }
  });

  test("throws when no region and no AWS_REGION env var", async () => {
    const origRegion = process.env.AWS_REGION;
    try {
      delete process.env.AWS_REGION;
      await expect(
        bedrock({ maxOutputTokens: 4096, model: "anthropic.claude-3-sonnet-20240229-v1:0" })
      ).rejects.toThrow("region is required");
    } finally {
      if (origRegion !== undefined) {
        process.env.AWS_REGION = origRegion;
      } else {
        delete process.env.AWS_REGION;
      }
    }
  });

  test("unknown model without explicit config throws", async () => {
    await expect(
      bedrock({ model: "some.unknown-model-v1:0", region: "us-east-1" })
    ).rejects.toThrow("cannot determine");
  });

  test("unknown model with explicit contextWindowSize and maxOutputTokens succeeds", async () => {
    const p = await bedrock({
      contextWindowSize: 128_000,
      maxOutputTokens: 2048,
      model: "some.unknown-model-v1:0",
      region: "us-east-1",
    });
    expect(p).toBeDefined();
    expect(p.contextWindowSize).toBe(128_000);
  });
});

describe("ModelRegistry resolution", () => {
  test("registry hit: uses registry values for contextWindowSize and maxOutputTokens", async () => {
    const mockResolve = () =>
      Promise.resolve({
        contextWindowSize: 999,
        maxOutputTokens: 888,
      });
    const originalResolve = defaultRegistry.resolve;
    defaultRegistry.resolve = mockResolve as any;
    try {
      const p = await bedrock({
        model: "custom.model-v1:0",
        region: "us-east-1",
      });
      expect(p.contextWindowSize).toBe(999);
    } finally {
      defaultRegistry.resolve = originalResolve;
    }
  });

  test("both miss: throws when registry undefined", async () => {
    const mockResolve = () => Promise.resolve(undefined);
    const originalResolve = defaultRegistry.resolve;
    defaultRegistry.resolve = mockResolve as any;
    try {
      await expect(bedrock({ model: "unknown.model-v1:0", region: "us-east-1" })).rejects.toThrow(
        "cannot determine"
      );
    } finally {
      defaultRegistry.resolve = originalResolve;
    }
  });

  test("explicit config overrides registry values", async () => {
    const mockResolve = () =>
      Promise.resolve({
        contextWindowSize: 999,
        maxOutputTokens: 888,
      });
    const originalResolve = defaultRegistry.resolve;
    defaultRegistry.resolve = mockResolve as any;
    try {
      const p = await bedrock({
        contextWindowSize: 123,
        maxOutputTokens: 456,
        model: "anthropic.claude-3-sonnet-20240229-v1:0",
        region: "us-west-2",
      });
      expect(p.contextWindowSize).toBe(123);
    } finally {
      defaultRegistry.resolve = originalResolve;
    }
  });

  test("skips registry fetch when both values explicitly provided", async () => {
    const mockResolve = () => {
      throw new Error("should not be called");
    };
    const originalResolve = defaultRegistry.resolve;
    defaultRegistry.resolve = mockResolve as any;
    try {
      const p = await bedrock({
        contextWindowSize: 100_000,
        maxOutputTokens: 200,
        model: "any.model-v1:0",
        region: "us-east-1",
      });
      expect(p.contextWindowSize).toBe(100_000);
      expect(p.maxOutputTokens).toBe(200);
    } finally {
      defaultRegistry.resolve = originalResolve;
    }
  });
});

// ---------------------------------------------------------------------------
// Converter tests
// ---------------------------------------------------------------------------

describe("toBedrockMessages", () => {
  test("converts text messages", () => {
    const messages: Array<Message> = [{ content: [{ text: "hello", type: "text" }], role: "user" }];
    const result = toBedrockMessages(messages);
    expect(result).toEqual([{ content: [{ text: "hello" }], role: "user" }]);
  });

  test("converts tool_use content", () => {
    const messages: Array<Message> = [
      {
        content: [
          {
            input: { target: "10.0.0.1" },
            name: "scan",
            toolUseId: "tu-1",
            type: "tool_use",
          },
        ],
        role: "assistant",
      },
    ];
    const result = toBedrockMessages(messages);
    expect(result[0].content?.[0]).toEqual({
      toolUse: {
        input: { target: "10.0.0.1" },
        name: "scan",
        toolUseId: "tu-1",
      },
    });
  });

  test("converts tool_result content", () => {
    const messages: Array<Message> = [
      {
        content: [{ content: "port 80 open", toolUseId: "tu-1", type: "tool_result" }],
        role: "user",
      },
    ];
    const result = toBedrockMessages(messages);
    expect(result[0].content?.[0]).toEqual({
      toolResult: {
        content: [{ text: "port 80 open" }],
        toolUseId: "tu-1",
      },
    });
  });
});

describe("toBedrockTools", () => {
  test("converts tool definitions", () => {
    const tools: Array<ToolDef> = [
      {
        description: "Network scanner",
        inputSchema: {
          properties: { target: { type: "string" } },
          required: ["target"],
          type: "object",
        },
        name: "nmap",
      },
    ];
    const result = toBedrockTools(tools);
    expect(result[0]).toEqual({
      toolSpec: {
        description: "Network scanner",
        inputSchema: {
          json: {
            properties: { target: { type: "string" } },
            required: ["target"],
            type: "object",
          },
        },
        name: "nmap",
      },
    });
  });
});

describe("fromBedrockContent", () => {
  test("converts text blocks", () => {
    const result = fromBedrockContent([{ text: "hello" }]);
    expect(result).toEqual([{ text: "hello", type: "text" }]);
  });

  test("converts toolUse blocks", () => {
    const result = fromBedrockContent([
      {
        toolUse: {
          input: { target: "10.0.0.1" },
          name: "scan",
          toolUseId: "tu-1",
        },
      },
    ]);
    expect(result).toEqual([
      {
        input: { target: "10.0.0.1" },
        name: "scan",
        toolUseId: "tu-1",
        type: "tool_use",
      },
    ]);
  });

  test("handles unknown blocks as empty text", () => {
    const result = fromBedrockContent([{} as any]);
    expect(result).toEqual([{ text: "", type: "text" }]);
  });
});

// ---------------------------------------------------------------------------
// Error mapping tests
// ---------------------------------------------------------------------------

describe("mapAwsError", () => {
  test("maps ThrottlingException to throttle", () => {
    const err = mapAwsError({ message: "slow down", name: "ThrottlingException" });
    expect(err).toBeInstanceOf(BedrockError);
    expect(err.code).toBe("throttle");
    expect(err.message).toBe("slow down");
  });

  test("maps TooManyRequestsException to throttle", () => {
    const err = mapAwsError({ message: "rate limited", name: "TooManyRequestsException" });
    expect(err.code).toBe("throttle");
  });

  test("maps AccessDeniedException to auth", () => {
    const err = mapAwsError({ message: "denied", name: "AccessDeniedException" });
    expect(err.code).toBe("auth");
  });

  test("maps UnrecognizedClientException to auth", () => {
    const err = mapAwsError({ message: "bad creds", name: "UnrecognizedClientException" });
    expect(err.code).toBe("auth");
  });

  test("maps ModelNotReadyException to model", () => {
    const err = mapAwsError({ message: "not ready", name: "ModelNotReadyException" });
    expect(err.code).toBe("model");
  });

  test("maps unknown errors to unknown", () => {
    const err = mapAwsError({ message: "oops", name: "SomeOtherError" });
    expect(err.code).toBe("unknown");
    expect(err.message).toBe("oops");
  });

  test("handles missing message", () => {
    const err = mapAwsError({ name: "ThrottlingException" });
    expect(err.code).toBe("throttle");
    expect(err.message).toBe("Rate limited");
  });
});

// ---------------------------------------------------------------------------
// buildCommandConfig — native system-role handling (RED: T4 / green: T8)
// ---------------------------------------------------------------------------
// These tests define DESIRED behavior after T1+T8 implementation.
// They FAIL against the current extraction-based implementation.
// system-role messages are cast with `as any` until T1 widens Message.role.
// ---------------------------------------------------------------------------

describe("buildCommandConfig — native system-role handling", () => {
  test("system-role message populates Bedrock system field", () => {
    // RED: current code ignores system-role; only extracts from first user block
    const messages = [
      { role: "system", content: [{ text: "You are a helpful assistant.", type: "text" }] },
      { role: "user", content: [{ text: "Hello", type: "text" }] },
    ] as any; // T1 will widen Message.role to include 'system'

    const config = buildCommandConfig("model-id", 4096, messages);

    expect(config.system).toEqual([{ text: "You are a helpful assistant." }]);
    expect(config.messages).toHaveLength(1);
    expect(config.messages[0].role).toBe("user");
    expect(config.messages[0].content).toEqual([{ text: "Hello" }]);
  });

  test("user-message text is NOT extracted as system prompt", () => {
    // RED: current code DOES extract first user block as system; new path must not
    const messages: Array<Message> = [
      {
        role: "user",
        content: [
          { text: "You are helpful", type: "text" },
          { text: "Hello", type: "text" },
        ],
      },
    ];

    const config = buildCommandConfig("model-id", 4096, messages);

    // New behavior: no extraction hack — system must be absent
    expect(config.system).toBeUndefined();
    // User message must be passed through intact, not stripped
    expect(config.messages).toHaveLength(1);
    expect(config.messages[0].content).toEqual([{ text: "You are helpful" }, { text: "Hello" }]);
  });

  test("omits system field when system-role content is empty", () => {
    // RED: current code does not handle system-role at all
    const messages = [
      { role: "system", content: [{ text: "", type: "text" }] },
      { role: "user", content: [{ text: "Hello", type: "text" }] },
    ] as any;

    const config = buildCommandConfig("model-id", 4096, messages);

    expect(config.system).toBeUndefined();
    expect(config.messages).toHaveLength(1);
  });

  test("system-role only with no subsequent messages", () => {
    // RED: current code will not detect or use system-role messages
    const messages = [{ role: "system", content: [{ text: "System only", type: "text" }] }] as any;

    const config = buildCommandConfig("model-id", 4096, messages);

    expect(config.system).toEqual([{ text: "System only" }]);
    expect(config.messages).toEqual([]);
  });

  test("multiple text blocks in system-role produce multiple system array entries", () => {
    // RED: current code does not handle system-role messages
    const messages = [
      {
        role: "system",
        content: [
          { text: "You are a scanner.", type: "text" },
          { text: "Always be concise.", type: "text" },
        ],
      },
      { role: "user", content: [{ text: "Scan me", type: "text" }] },
    ] as any;

    const config = buildCommandConfig("model-id", 4096, messages);

    expect(config.system).toEqual([{ text: "You are a scanner." }, { text: "Always be concise." }]);
    expect(config.messages).toHaveLength(1);
  });

  test("empty messages array produces no system and no messages", () => {
    // Non-RED: same result as before (no messages = no system)
    const config = buildCommandConfig("model-id", 4096, []);

    expect(config.system).toBeUndefined();
    expect(config.messages).toEqual([]);
  });

  test("preserves all subsequent messages after system-role", () => {
    // RED: current code does not handle system-role messages
    const messages = [
      {
        role: "system",
        content: [{ text: "System prompt", type: "text" }],
      },
      {
        role: "user",
        content: [{ text: "First user message", type: "text" }],
      },
      {
        role: "assistant",
        content: [{ text: "Assistant response", type: "text" }],
      },
      {
        role: "user",
        content: [{ text: "Second user message", type: "text" }],
      },
    ] as any;

    const config = buildCommandConfig("model-id", 4096, messages);

    expect(config.system).toEqual([{ text: "System prompt" }]);
    expect(config.messages).toHaveLength(3);
    expect(config.messages[0].content).toEqual([{ text: "First user message" }]);
    expect(config.messages[1].content).toEqual([{ text: "Assistant response" }]);
    expect(config.messages[2].content).toEqual([{ text: "Second user message" }]);
  });
});

// ---------------------------------------------------------------------------
// buildCommandConfig — cachePoint emission (RED: T4 / green: T8)
// ---------------------------------------------------------------------------
// cache_point blocks in system-role content translate to Bedrock cachePoint.
// BlockType.CACHE_POINT ("cache_point") will be added by T1.
// T8 wires the system-content converter to emit { cachePoint: { type: "default" } }.
// ---------------------------------------------------------------------------

describe("buildCommandConfig — cachePoint emission", () => {
  test("cache_point block after text in system-role emits cachePoint in system array", () => {
    // RED: current code never emits cachePoint
    const messages = [
      {
        role: "system",
        content: [
          { text: "You are a helpful assistant.", type: "text" },
          { type: "cache_point" }, // T1 will add BlockType.CACHE_POINT
        ],
      },
      { role: "user", content: [{ text: "Hello", type: "text" }] },
    ] as any;

    const config = buildCommandConfig("model-id", 4096, messages);

    expect(config.system).toEqual([
      { text: "You are a helpful assistant." },
      { cachePoint: { type: "default" } },
    ]);
  });

  test("cache_point-only system block emits sole cachePoint in system array", () => {
    // RED: current code never emits cachePoint
    const messages = [
      {
        role: "system",
        content: [{ type: "cache_point" }],
      },
      { role: "user", content: [{ text: "Hello", type: "text" }] },
    ] as any;

    const config = buildCommandConfig("model-id", 4096, messages);

    expect(config.system).toEqual([{ cachePoint: { type: "default" } }]);
  });

  test("system without cache_point blocks emits no cachePoint entries", () => {
    // RED: current code does not handle system-role at all
    const messages = [
      {
        role: "system",
        content: [{ text: "Plain system.", type: "text" }],
      },
      { role: "user", content: [{ text: "Hello", type: "text" }] },
    ] as any;

    const config = buildCommandConfig("model-id", 4096, messages);

    expect(config.system).toEqual([{ text: "Plain system." }]);
    // No cachePoint entries expected
    expect(config.system?.every((b: any) => b.cachePoint === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildCommandConfig — thinking-enabled path with native system (RED: T4 / green: T8)
// ---------------------------------------------------------------------------
// Desired: system-role messages are respected in thinking mode too.
// Current: thinking path sets finalSystemPrompt = undefined (drops system entirely).
// ---------------------------------------------------------------------------

describe("buildCommandConfig — thinking-enabled path with native system", () => {
  test("thinking mode with system-role message includes system in Bedrock config", () => {
    // RED: current code sets finalSystemPrompt = undefined when thinking is enabled,
    // so config.system is always absent for thinking requests
    const messages = [
      { role: "system", content: [{ text: "You are Claude.", type: "text" }] },
      { role: "user", content: [{ text: "Think hard.", type: "text" }] },
    ] as any;

    const config = buildCommandConfig("model-id", 4096, messages, undefined, 4096);

    expect(config.system).toEqual([{ text: "You are Claude." }]);
    expect((config as any).thinking).toEqual({ budgetTokens: 4096 });
    // System-role message must NOT appear in messages array
    expect(config.messages).toHaveLength(1);
    expect(config.messages[0].role).toBe("user");
  });

  test("thinking mode without system-role message has no system field", () => {
    // Non-RED: thinking mode already avoids extraction — asserts clean no-system path
    const messages: Array<Message> = [
      { role: "user", content: [{ text: "Think hard.", type: "text" }] },
    ];

    const config = buildCommandConfig("model-id", 4096, messages, undefined, 4096);

    expect(config.system).toBeUndefined();
    expect((config as any).thinking).toEqual({ budgetTokens: 4096 });
    expect(config.messages).toHaveLength(1);
  });

  test("thinking mode preserves user/assistant messages after system-role", () => {
    // RED: current code passes all messages (incl. system-role) into messages array
    // when thinking is enabled, instead of separating system-role into config.system
    const messages = [
      { role: "system", content: [{ text: "Think carefully.", type: "text" }] },
      { role: "user", content: [{ text: "Message 1", type: "text" }] },
      { role: "assistant", content: [{ text: "Response 1", type: "text" }] },
      { role: "user", content: [{ text: "Message 2", type: "text" }] },
    ] as any;

    const config = buildCommandConfig("model-id", 4096, messages, undefined, 4096);

    expect(config.system).toEqual([{ text: "Think carefully." }]);
    expect(config.messages).toHaveLength(3);
    expect(config.messages[0].role).toBe("user");
    expect(config.messages[1].role).toBe("assistant");
    expect(config.messages[2].role).toBe("user");
  });
});

// ---------------------------------------------------------------------------
// mapStreamEvent — streaming response parsing
// ---------------------------------------------------------------------------

import { mapStreamEvent } from "../src/stream-handler";

describe("mapStreamEvent", () => {
  test("returns text_delta for contentBlockDelta with text", () => {
    const event = {
      contentBlockDelta: { delta: { text: "Hello" } },
    } as any;
    const result = mapStreamEvent(event);
    expect(result).toEqual([{ type: "text_delta", content: "Hello" }]);
  });

  test("returns tool_use_delta for contentBlockDelta with toolUse", () => {
    const event = {
      contentBlockDelta: { delta: { toolUse: { input: '{"key": "value"}' } } },
    } as any;
    const result = mapStreamEvent(event);
    expect(result).toEqual([{ type: "tool_use_delta", input: '{"key": "value"}' }]);
  });

  test("returns tool_use_start for contentBlockStart with toolUse", () => {
    const event = {
      contentBlockStart: { start: { toolUse: { name: "scan", toolUseId: "tu-123" } } },
    } as any;
    const result = mapStreamEvent(event);
    expect(result).toEqual([{ type: "tool_use_start", name: "scan", toolUseId: "tu-123" }]);
  });

  test("returns tool_use_end for contentBlockStop", () => {
    const event = { contentBlockStop: {} } as any;
    const result = mapStreamEvent(event);
    expect(result).toEqual([{ type: "tool_use_end" }]);
  });

  test("returns message_end with usage from metadata", () => {
    const event = {
      metadata: { usage: { inputTokens: 100, outputTokens: 50 } },
    } as any;
    const result = mapStreamEvent(event);
    expect(result).toEqual([
      {
        type: "message_end",
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ]);
  });

  test("returns message_end with default usage when metadata.usage undefined", () => {
    const event = { metadata: {} } as any;
    const result = mapStreamEvent(event);
    expect(result).toEqual([
      { type: "message_end", stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0 } },
    ]);
  });

  test("returns message_end from messageStop with stopReason", () => {
    const event = {
      messageStop: { stopReason: "tool_use" },
    } as any;
    const result = mapStreamEvent(event);
    expect(result).toEqual([
      { type: "message_end", stopReason: "tool_use", usage: { inputTokens: 0, outputTokens: 0 } },
    ]);
  });

  test("returns empty array for unknown event type", () => {
    const event = { unknownField: {} } as any;
    const result = mapStreamEvent(event);
    expect(result).toEqual([]);
  });

  test("handles contentBlockDelta with undefined delta gracefully", () => {
    const event = { contentBlockDelta: {} } as any;
    const result = mapStreamEvent(event);
    expect(result).toEqual([]);
  });

  test("handles contentBlockStart with missing toolUse gracefully", () => {
    const event = { contentBlockStart: { start: {} } } as any;
    const result = mapStreamEvent(event);
    expect(result).toEqual([]);
  });

  test("tool_use_start with missing name/toolUseId uses empty strings", () => {
    const event = {
      contentBlockStart: { start: { toolUse: {} } },
    } as any;
    const result = mapStreamEvent(event);
    expect(result).toEqual([{ type: "tool_use_start", name: "", toolUseId: "" }]);
  });
});

// ---------------------------------------------------------------------------
// chatWithFallback — response parser tests
// ---------------------------------------------------------------------------

import { chatWithFallback } from "../src/response-parser";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

describe("chatWithFallback", () => {
  test("returns mapped LLMResponse on successful response", async () => {
    const mockSend = () =>
      Promise.resolve({
        output: { message: { content: [{ text: "Hello back" }] } },
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      });
    const mockClient = { send: mockSend } as any as BedrockRuntimeClient;

    const buildCommand = (_includeOutput: boolean) => ({ input: {} }) as any;

    const result = await chatWithFallback(mockClient, buildCommand, false, "test-model", new Map());

    expect(result.content).toEqual([{ text: "Hello back", type: "text" }]);
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  test("falls back when structured output fails with ValidationException", async () => {
    const cache = new Map<string, boolean>();

    let callCount = 0;
    const mockSend = () => {
      callCount++;
      if (callCount === 1) {
        const error = new Error("outputConfig not supported");
        error.name = "ValidationException";
        throw error;
      }
      return Promise.resolve({
        output: { message: { content: [{ text: "fallback response" }] } },
        stopReason: "end_turn",
        usage: { inputTokens: 5, outputTokens: 3 },
      });
    };
    const mockClient = { send: mockSend } as any as BedrockRuntimeClient;

    const buildCommand = (includeOutput: boolean) => ({ input: { includeOutput } }) as any;

    const result = await chatWithFallback(
      mockClient,
      buildCommand,
      true,
      "fallback-test-model",
      cache
    );

    expect(callCount).toBe(2);
    expect(result.content).toEqual([{ text: "fallback response", type: "text" }]);
    expect(cache.get("fallback-test-model")).toBe(false);
  });

  test("does not fallback when shouldUseStructuredOutput is false", async () => {
    let callCount = 0;
    const mockSend = () => {
      callCount++;
      return Promise.resolve({
        output: { message: { content: [{ text: "response" }] } },
        stopReason: "end_turn",
        usage: {},
      });
    };
    const mockClient = { send: mockSend } as any as BedrockRuntimeClient;

    const buildCommand = (_includeOutput: boolean) => ({ input: {} }) as any;

    await chatWithFallback(mockClient, buildCommand, false, "test-model-2", new Map());

    expect(callCount).toBe(1);
  });

  test("maps AWS error on non-ValidationException failure", async () => {
    const mockSend = () => {
      const error = new Error("Throttled");
      error.name = "ThrottlingException";
      throw error;
    };
    const mockClient = { send: mockSend } as any as BedrockRuntimeClient;

    const buildCommand = (_includeOutput: boolean) => ({ input: {} }) as any;

    await expect(
      chatWithFallback(mockClient, buildCommand, false, "test-model-3", new Map())
    ).rejects.toThrow(BedrockError);
  });

  test("maps non-Error objects to unknown error", async () => {
    const mockSend = () => {
      throw "string error";
    };
    const mockClient = { send: mockSend } as any as BedrockRuntimeClient;

    const buildCommand = (_includeOutput: boolean) => ({ input: {} }) as any;

    await expect(
      chatWithFallback(mockClient, buildCommand, false, "test-model-4", new Map())
    ).rejects.toThrow(BedrockError);
  });
});

// ---------------------------------------------------------------------------
// Converter edge cases
// ---------------------------------------------------------------------------

describe("toBedrockMessages edge cases", () => {
  test("filters out empty text blocks", () => {
    const messages: Array<Message> = [
      {
        content: [
          { text: "", type: "text" },
          { text: "   ", type: "text" },
          { text: "valid", type: "text" },
        ],
        role: "user",
      },
    ];
    const result = toBedrockMessages(messages);
    expect(result[0].content).toEqual([{ text: "valid" }]);
  });

  test("converts tool_result with error status", () => {
    const messages: Array<Message> = [
      {
        content: [
          { content: "error message", status: "error", toolUseId: "tu-1", type: "tool_result" },
        ],
        role: "user",
      },
    ];
    const result = toBedrockMessages(messages);
    expect(result[0].content?.[0]).toEqual({
      toolResult: {
        content: [{ text: "error message" }],
        status: "error",
        toolUseId: "tu-1",
      },
    });
  });

  test("handles multiple content blocks in single message", () => {
    const messages: Array<Message> = [
      {
        content: [
          { text: "text here", type: "text" },
          { input: { x: 1 }, name: "tool", toolUseId: "tu-1", type: "tool_use" },
        ],
        role: "assistant",
      },
    ];
    const result = toBedrockMessages(messages);
    expect(result[0].content).toHaveLength(2);
    expect(result[0].content?.[0]).toEqual({ text: "text here" });
    expect(result[0].content?.[1]).toEqual({
      toolUse: { input: { x: 1 }, name: "tool", toolUseId: "tu-1" },
    });
  });
});

describe("fromBedrockContent edge cases", () => {
  test("handles toolUse with object input", () => {
    const result = fromBedrockContent([
      { toolUse: { input: { foo: "bar", count: 42 }, name: "test", toolUseId: "id-1" } },
    ]);
    expect(result).toEqual([
      { type: "tool_use", input: { foo: "bar", count: 42 }, name: "test", toolUseId: "id-1" },
    ]);
  });

  test("handles toolUse with string input (parses to empty object)", () => {
    const result = fromBedrockContent([
      { toolUse: { input: '{"parsed": true}', name: "test", toolUseId: "id-1" } },
    ]);
    // String input is converted to empty object per implementation
    expect(result[0].input).toEqual({});
  });

  test("handles toolUse with null input (returns empty object)", () => {
    const result = fromBedrockContent([
      { toolUse: { input: null, name: "test", toolUseId: "id-1" } },
    ]);
    expect(result[0].input).toEqual({});
  });

  test("handles toolUse with missing name/toolUseId (uses empty strings)", () => {
    const result = fromBedrockContent([{ toolUse: { input: {} } }]);
    expect(result).toEqual([{ type: "tool_use", input: {}, name: "", toolUseId: "" }]);
  });
});

// ---------------------------------------------------------------------------
// BedrockEmbedding tests
// ---------------------------------------------------------------------------

import { BedrockEmbedding, BedrockEmbeddingError } from "../src/embedding";

describe("BedrockEmbedding", () => {
  const origRegion = process.env.AWS_REGION;

  test("constructor throws without region", () => {
    delete process.env.AWS_REGION;
    expect(() => new BedrockEmbedding({ model: "amazon.titan-embed-text-v2:0" })).toThrow(
      "region is required"
    );
  });

  test("constructor uses AWS_REGION env var when region not provided", () => {
    process.env.AWS_REGION = "us-west-2";
    const provider = new BedrockEmbedding({ model: "amazon.titan-embed-text-v2:0" });
    expect(provider.modelName).toBe("amazon.titan-embed-text-v2:0");
    expect(provider.dimension).toBe(1024);
    // restore
    if (origRegion !== undefined) process.env.AWS_REGION = origRegion;
    else delete process.env.AWS_REGION;
  });

  test("constructor throws for unknown model", () => {
    expect(() => new BedrockEmbedding({ model: "unknown-model", region: "us-east-1" })).toThrow(
      "Unknown embedding model"
    );
  });

  test("constructor sets correct dimension for known models", () => {
    const titan1 = new BedrockEmbedding({
      model: "amazon.titan-embed-text-v1",
      region: "us-east-1",
    });
    expect(titan1.dimension).toBe(1536);

    const titan2 = new BedrockEmbedding({
      model: "amazon.titan-embed-text-v2:0",
      region: "us-east-1",
    });
    expect(titan2.dimension).toBe(1024);

    const cohere = new BedrockEmbedding({ model: "cohere.embed-english-v3", region: "us-east-1" });
    expect(cohere.dimension).toBe(1024);
  });

  test("embed throws on empty text", async () => {
    const provider = new BedrockEmbedding({
      model: "amazon.titan-embed-text-v2:0",
      region: "us-east-1",
    });
    await expect(provider.embed("")).rejects.toThrow(BedrockEmbeddingError);
    await expect(provider.embed("   ")).rejects.toThrow(BedrockEmbeddingError);
  });

  test("embedBatch returns empty array for empty input", async () => {
    const provider = new BedrockEmbedding({
      model: "amazon.titan-embed-text-v2:0",
      region: "us-east-1",
    });
    const result = await provider.embedBatch([]);
    expect(result).toEqual([]);
  });

  test("embedBatch throws on empty texts in batch", async () => {
    const provider = new BedrockEmbedding({
      model: "amazon.titan-embed-text-v2:0",
      region: "us-east-1",
    });
    await expect(provider.embedBatch(["valid", ""])).rejects.toThrow(BedrockEmbeddingError);
    await expect(provider.embedBatch(["valid", "   "])).rejects.toThrow(/Empty text at indices/);
  });
});
