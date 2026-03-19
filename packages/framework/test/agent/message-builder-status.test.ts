import { describe, expect, test } from "bun:test";
import {
  buildToolResultMessages,
  buildToolResultMessagesWithTruncation,
} from "../../src/agent/message-builder";
import type { ToolResultContent } from "../../src/types";

describe("buildToolResultMessages - status propagation", () => {
  test("result with isError=true → content has status: 'error'", () => {
    const results = [{ isError: true, result: "error output", toolUseId: "t1" }];
    const messages = buildToolResultMessages(results);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toHaveLength(1);

    const content = messages[0].content[0] as ToolResultContent;
    expect(content.type).toBe("tool_result");
    expect(content.toolUseId).toBe("t1");
    expect(content.content).toBe("error output");
    expect(content.status).toBe("error");
  });

  test("result without isError → content has status: 'success'", () => {
    const results = [{ result: "ok", toolUseId: "t1" }];
    const messages = buildToolResultMessages(results);

    expect(messages).toHaveLength(1);
    const content = messages[0].content[0] as ToolResultContent;
    expect(content.type).toBe("tool_result");
    expect(content.toolUseId).toBe("t1");
    expect(content.content).toBe("ok");
    expect(content.status).toBe("success");
  });

  test("result with isError=false → content has status: 'success'", () => {
    const results = [{ isError: false, result: "ok", toolUseId: "t1" }];
    const messages = buildToolResultMessages(results);

    expect(messages).toHaveLength(1);
    const content = messages[0].content[0] as ToolResultContent;
    expect(content.type).toBe("tool_result");
    expect(content.status).toBe("success");
  });

  test("mixed results - error and success", () => {
    const results = [
      { isError: true, result: "error", toolUseId: "t1" },
      { result: "ok", toolUseId: "t2" },
    ];
    const messages = buildToolResultMessages(results);

    expect(messages[0].content).toHaveLength(2);
    const content1 = messages[0].content[0] as ToolResultContent;
    const content2 = messages[0].content[1] as ToolResultContent;

    expect(content1.status).toBe("error");
    expect(content2.status).toBe("success");
  });
});

describe("buildToolResultMessagesWithTruncation - status preservation", () => {
  test("isError survives truncation", async () => {
    const results = [
      { isError: true, result: "error message content", toolName: "test-tool", toolUseId: "t1" },
    ];
    const resolvedTruncation = {
      active: true as const,
      config: {
        blobStore: undefined,
        threshold: 10,
      },
    };

    const messages = await buildToolResultMessagesWithTruncation(
      results,
      resolvedTruncation,
      undefined
    );

    expect(messages).toHaveLength(1);
    const content = messages[0].content[0] as ToolResultContent;
    expect(content.type).toBe("tool_result");
    expect(content.status).toBe("error");
    expect(content.content).toContain("[Output truncated");
  });

  test("non-error result survives truncation with status: 'success'", async () => {
    const results = [{ result: "success message content", toolName: "test-tool", toolUseId: "t1" }];
    const resolvedTruncation = {
      active: true as const,
      config: {
        blobStore: undefined,
        threshold: 10,
      },
    };

    const messages = await buildToolResultMessagesWithTruncation(
      results,
      resolvedTruncation,
      undefined
    );

    expect(messages).toHaveLength(1);
    const content = messages[0].content[0] as ToolResultContent;
    expect(content.type).toBe("tool_result");
    expect(content.status).toBe("success");
    expect(content.content).toContain("[Output truncated");
  });

  test("plugin config disables truncation but preserves error status", async () => {
    const results = [
      { isError: true, result: "error output", toolName: "no-truncate-tool", toolUseId: "t1" },
    ];
    const resolvedTruncation = {
      active: true as const,
      config: {
        blobStore: undefined,
        threshold: 10,
      },
    };
    const pluginTruncation = new Map([["no-truncate-tool", { enabled: false }]]);

    const messages = await buildToolResultMessagesWithTruncation(
      results,
      resolvedTruncation,
      pluginTruncation
    );

    expect(messages).toHaveLength(1);
    const content = messages[0].content[0] as ToolResultContent;
    expect(content.type).toBe("tool_result");
    expect(content.status).toBe("error");
    expect(content.content).toBe("error output");
  });
});
