import { MessageRole } from "../src/types/constants";
import type { Message } from "../src/types/llm";
import { describe, expect, test } from "bun:test";
import {
  buildBackgroundNotifications,
  buildInitialMessages,
  buildToolResultMessages,
} from "../src/agent/message-builder";
import { TaskManager } from "../src/background";

describe("buildInitialMessages", () => {
  test("returns separate system and user messages when no history (prompt cache optimization)", () => {
    const messages = buildInitialMessages("System prompt here", "User input here");

    // RED: These assertions expect separate messages (will fail against current merged impl)
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect((messages[0].content[0] as { text: string; type: "text" }).text).toBe(
      "System prompt here"
    );
    expect(messages[1].role).toBe("user");
    expect((messages[1].content[0] as { text: string; type: "text" }).text).toBe("User input here");
  });

  test("prepends separate system message before history (first history is user)", () => {
    const history = [
      { role: "user" as const, content: [{ type: "text" as const, text: "Previous user" }] },
    ];
    const messages = buildInitialMessages("System prompt", "New input", history);

    // RED: System should be separate message, not merged with first history
    expect(messages).toHaveLength(3); // system + history[0] + new user
    expect(messages[0].role).toBe("system");
    expect((messages[0].content[0] as { text: string; type: "text" }).text).toBe("System prompt");
    expect(messages[1].role).toBe("user");
    expect((messages[1].content[0] as { text: string; type: "text" }).text).toBe("Previous user");
    expect(messages[2].role).toBe("user");
    expect((messages[2].content[0] as { text: string; type: "text" }).text).toBe("New input");
  });

  test("prepends separate system message before history (first history is assistant)", () => {
    const history = [
      { role: "assistant" as const, content: [{ type: "text" as const, text: "Assistant reply" }] },
    ];
    const messages = buildInitialMessages("System prompt", "New input", history);

    // RED: System should be separate message
    expect(messages).toHaveLength(3); // system + history[0] + new user
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("assistant");
  });

  test("handles empty strings as separate messages", () => {
    const messages = buildInitialMessages("", "");

    // RED: Even empty strings should result in separate message structure
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  test("transient late-context insertion seam: system message has metadata slot for context blocks", () => {
    const messages = buildInitialMessages("System prompt", "User input");

    // RED: System message should support late-context insertion seam
    // This verifies the structure allows transient context injection before the user message
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");

    // The system message should be a distinct message that can be modified
    // to insert context blocks (e.g., search results, memory) before user message
    expect(Array.isArray(messages[0].content)).toBe(true);
  });
});

describe("buildBackgroundNotifications", () => {
  test("returns empty messages when no completed tasks", () => {
    const taskManager = new TaskManager();
    const result = buildBackgroundNotifications(taskManager, Date.now());

    expect(result.messages).toHaveLength(0);
    expect(result.newCheckTime).toBeGreaterThan(0);
  });

  test("returns notification message when tasks completed", async () => {
    const taskManager = new TaskManager();
    const beforeStart = Date.now();

    // Start and complete a background task
    taskManager.start("test-plugin", async () => "result");

    // Wait for task to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    const result = buildBackgroundNotifications(taskManager, beforeStart);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content[0].type).toBe("text");

    const text = (result.messages[0].content[0] as { text: string; type: "text" }).text;
    expect(text).toContain("Background tasks completed");
    expect(text).toContain("task-");
    expect(text).toContain("use get_result to retrieve");
    expect(result.newCheckTime).toBeGreaterThan(beforeStart);
  });

  test("returns empty messages when no new completed tasks since last check", async () => {
    const taskManager = new TaskManager();

    // Start and complete a background task
    taskManager.start("test-plugin", async () => "result");

    // Wait for task to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    const afterCompletion = Date.now();

    // Now check with timestamp after completion
    const result = buildBackgroundNotifications(taskManager, afterCompletion);

    expect(result.messages).toHaveLength(0);
    expect(result.newCheckTime).toBe(afterCompletion);
  });

  test("includes multiple completed tasks in notification", async () => {
    const taskManager = new TaskManager();
    const beforeStart = Date.now();

    taskManager.start("plugin-a", async () => "result-a");
    taskManager.start("plugin-b", async () => "result-b");

    await new Promise((resolve) => setTimeout(resolve, 50));

    const result = buildBackgroundNotifications(taskManager, beforeStart);

    expect(result.messages).toHaveLength(1);
    const text = (result.messages[0].content[0] as { text: string; type: "text" }).text;
    expect(text).toContain("Background tasks completed");
    expect(text).toContain("task-");
    expect(text.match(/task-/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("buildToolResultMessages", () => {
  test("maps single result to tool_result message", () => {
    const results = [{ result: "success output", toolUseId: "tool-123" }];
    const messages = buildToolResultMessages(results);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toHaveLength(1);
    expect(messages[0].content[0].type).toBe("tool_result");
    expect(
      (messages[0].content[0] as { content: string; toolUseId: string; type: "tool_result" })
        .toolUseId
    ).toBe("tool-123");
    expect(
      (messages[0].content[0] as { content: string; toolUseId: string; type: "tool_result" })
        .content
    ).toBe("success output");
  });

  test("maps multiple results to single merged message", () => {
    const results = [
      { result: "result-1", toolUseId: "tool-1" },
      { result: "result-2", toolUseId: "tool-2" },
    ];
    const messages = buildToolResultMessages(results);

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toHaveLength(2);
    expect((messages[0].content[0] as { toolUseId: string; type: "tool_result" }).toolUseId).toBe(
      "tool-1"
    );
    expect((messages[0].content[1] as { toolUseId: string; type: "tool_result" }).toolUseId).toBe(
      "tool-2"
    );
  });

  test("returns empty array for empty results", () => {
    const messages = buildToolResultMessages([]);
    expect(messages).toHaveLength(0);
  });

  test("handles result with special characters", () => {
    const results = [{ result: "line1\nline2\ttab", toolUseId: "tool-abc" }];
    const messages = buildToolResultMessages(results);

    expect((messages[0].content[0] as { content: string; type: "tool_result" }).content).toBe(
      "line1\nline2\ttab"
    );
  });
});

describe("system role support", () => {
  test("Message type should support system role", () => {
    // This test proves Message.role can be "system"
    const systemMessage: Message = {
      role: MessageRole.SYSTEM,
      content: [{ type: "text", text: "System instructions" }],
    };

    expect(systemMessage.role).toBe("system");
    expect(systemMessage.content).toHaveLength(1);
  });

  test("system role is distinct from user message", () => {
    const systemMessage: Message = {
      role: "system",
      content: [{ type: "text", text: "System prompt" }],
    };
    const userMessage: Message = {
      role: "user",
      content: [{ type: "text", text: "User input" }],
    };

    expect(systemMessage.role).not.toBe(userMessage.role);
    expect(systemMessage.role).toBe("system");
    expect(userMessage.role).toBe("user");
  });
});
