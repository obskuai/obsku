import { describe, expect, test } from "bun:test";
import { InMemoryCheckpointStore } from "@obsku/framework";
import { z } from "zod";
import { agent } from "../../src/agent";
import { plugin } from "../../src/plugin";
import type { LLMProvider, LLMResponse, Message } from "../../src/types";

describe("agent checkpoint integration", () => {
  const createEchoTool = () =>
    plugin({
      description: "Echoes input",
      name: "echo",
      params: z.object({ text: z.string().describe("text to echo") }),
      run: async (input) => ({ echoed: input.text }),
    });

  test("saves messages to checkpointStore after execution", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/test");
    const sessionId = session.id;

    const mockResponse: LLMResponse = {
      content: [{ text: "Hello from agent", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    const mockProvider: LLMProvider = {
      chat: async () => mockResponse,
      chatStream: async function* () {
        yield { content: "Hello", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "test-agent",
      prompt: "You are a test agent",
    });

    await a.run("Say hello", mockProvider, { checkpointStore: store, sessionId });

    const sessions = await store.listSessions();
    expect(sessions.length).toBeGreaterThan(0);

    const messages = await store.getMessages(sessionId);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.role === "user")).toBe(true);
  });

  test("loads messages from checkpointStore on session resume", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/test");
    const sessionId = session.id;

    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: async (messages: Array<Message>) => {
        callCount++;
        if (callCount === 1) {
          expect(messages.length).toBeGreaterThanOrEqual(1);
          return {
            content: [{ text: "First response", type: "text" }],
            stopReason: "end_turn",
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        return {
          content: [{ text: "Second response", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      chatStream: async function* () {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "test-agent",
      prompt: "You are a test agent",
    });

    await a.run("First message", mockProvider, { checkpointStore: store, sessionId });

    const messagesBefore = await store.getMessages(sessionId);
    expect(messagesBefore.length).toBeGreaterThan(0);

    callCount = 0;
    await a.run("Second message", mockProvider, { checkpointStore: store, sessionId });

    const messagesAfter = await store.getMessages(sessionId);
    expect(messagesAfter.length).toBeGreaterThan(messagesBefore.length);
  });

  test("saves tool calls and results to checkpointStore", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/test");
    const sessionId = session.id;

    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [
              { input: { text: "hello" }, name: "echo", toolUseId: "t1", type: "tool_use" },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        return {
          content: [{ text: "Done", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 20, outputTokens: 5 },
        };
      },
      chatStream: async function* () {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "tool-agent",
      prompt: "Use tools",
      tools: [createEchoTool()],
    });

    await a.run("echo hello", mockProvider, { checkpointStore: store, sessionId });

    const messages = await store.getMessages(sessionId);
    const assistantMsg = messages.find((m) => m.role === "assistant" && m.toolCalls);
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.toolCalls?.[0].name).toBe("echo");

    const toolMsg = messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.toolResults?.length).toBeGreaterThan(0);
  });

  test("backward compatibility: memory provider still works if no checkpointStore", async () => {
    const memoryMessages: Array<Message> = [];
    const memoryProvider = {
      load: async (_sessionId: string) => memoryMessages,
      save: async (_sessionId: string, messages: Array<Message>) => {
        memoryMessages.push(...messages);
      },
    };

    const mockResponse: LLMResponse = {
      content: [{ text: "Hello", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    const mockProvider: LLMProvider = {
      chat: async () => mockResponse,
      chatStream: async function* () {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({
      memory: memoryProvider,
      name: "memory-agent",
      prompt: "You are a test agent",
    });

    await a.run("Say hello", mockProvider, { sessionId: "memory-session" });

    expect(memoryMessages.length).toBeGreaterThan(0);
  });

  test("checkpointStore takes precedence when both memory and checkpointStore provided", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/test");
    const sessionId = session.id;

    const memoryMessages: Array<Message> = [];
    const memoryProvider = {
      load: async (_sessionId: string) => memoryMessages,
      save: async (_sessionId: string, messages: Array<Message>) => {
        memoryMessages.push(...messages);
      },
    };

    const mockResponse: LLMResponse = {
      content: [{ text: "Hello", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    const mockProvider: LLMProvider = {
      chat: async () => mockResponse,
      chatStream: async function* () {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({
      memory: memoryProvider,
      name: "dual-agent",
      prompt: "You are a test agent",
    });

    await a.run("Say hello", mockProvider, {
      checkpointStore: store,
      sessionId,
    });

    const checkpointMessages = await store.getMessages(sessionId);
    expect(checkpointMessages.length).toBeGreaterThan(0);

    expect(memoryMessages.length).toBe(0);
  });

  test("no persistence when neither checkpointStore nor memory provided", async () => {
    const mockResponse: LLMResponse = {
      content: [{ text: "Hello", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    const mockProvider: LLMProvider = {
      chat: async () => mockResponse,
      chatStream: async function* () {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "no-persist-agent",
      prompt: "You are a test agent",
    });

    const result = await a.run("Say hello", mockProvider);
    expect(result).toBe("Hello");
  });

  test("creates session if it does not exist when using checkpointStore", async () => {
    const store = new InMemoryCheckpointStore();
    const nonExistentSessionId = "non-existent-session-id";

    const mockResponse: LLMResponse = {
      content: [{ text: "Hello", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };

    const mockProvider: LLMProvider = {
      chat: async () => mockResponse,
      chatStream: async function* () {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "new-session-agent",
      prompt: "You are a test agent",
    });

    const sessionBefore = await store.getSession(nonExistentSessionId);
    expect(sessionBefore).toBeNull();

    await a.run("Say hello", mockProvider, {
      checkpointStore: store,
      sessionId: nonExistentSessionId,
    });

    const sessions = await store.listSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].title).toBe("Agent: new-session-agent");
  });

  test("saves tool result status from ToolResultContent to checkpointStore", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/test");
    const sessionId = session.id;

    const errorTool = {
      description: "Throws an error",
      name: "errorTool",
      params: z.object({}),
      run: async () => {
        throw new Error("Tool failed");
      },
    };

    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [{ input: {}, name: "errorTool", toolUseId: "t1", type: "tool_use" }],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        return {
          content: [{ text: "Tool returned error", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 20, outputTokens: 5 },
        };
      },
      chatStream: async function* () {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "error-tool-agent",
      prompt: "Use error tool",
      tools: [errorTool],
    });

    await a.run("run error tool", mockProvider, { checkpointStore: store, sessionId });

    const messages = await store.getMessages(sessionId);
    const toolMsg = messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.toolResults?.length).toBeGreaterThan(0);
    expect(toolMsg?.toolResults?.[0].status).toBe("error");
  });

  test("saves tool result with success status from ToolResultContent", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/test");
    const sessionId = session.id;

    let callCount = 0;
    const mockProvider: LLMProvider = {
      chat: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: [
              { input: { text: "hello" }, name: "echo", toolUseId: "t1", type: "tool_use" },
            ],
            stopReason: "tool_use" as const,
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }
        return {
          content: [{ text: "Done", type: "text" }],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 20, outputTokens: 5 },
        };
      },
      chatStream: async function* () {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({
      name: "success-tool-agent",
      prompt: "Use tools",
      tools: [createEchoTool()],
    });

    await a.run("echo hello", mockProvider, { checkpointStore: store, sessionId });

    const messages = await store.getMessages(sessionId);
    const toolMsg = messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.toolResults?.length).toBeGreaterThan(0);
    expect(toolMsg?.toolResults?.[0].status).toBe("success");
  });
});
