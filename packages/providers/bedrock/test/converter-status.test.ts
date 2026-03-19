import { describe, expect, test } from "bun:test";
import type { Message } from "@obsku/framework";
import { toBedrockMessages } from "../src/converters";

describe("toBedrockMessages - tool_result status handling", () => {
  test("ToolResultContent with status='error' → toolResult.status = 'error'", () => {
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

  test("ToolResultContent without status → toolResult has no status field", () => {
    const messages: Array<Message> = [
      {
        content: [{ content: "success output", toolUseId: "tu-1", type: "tool_result" }],
        role: "user",
      },
    ];
    const result = toBedrockMessages(messages);

    const content0 = result[0].content![0] as { toolResult: Record<string, unknown> };
    const toolResult = content0.toolResult;
    expect(toolResult.toolUseId).toBe("tu-1");
    expect(toolResult.content).toEqual([{ text: "success output" }]);
    expect(toolResult.status).toBeUndefined();
  });

  test("multiple tool results with mixed status", () => {
    const messages: Array<Message> = [
      {
        content: [
          { content: "error", status: "error", toolUseId: "tu-1", type: "tool_result" },
          { content: "success", toolUseId: "tu-2", type: "tool_result" },
          { content: "another error", status: "error", toolUseId: "tu-3", type: "tool_result" },
        ],
        role: "user",
      },
    ];
    const result = toBedrockMessages(messages);

    const contents = result[0].content;
    expect(contents).toHaveLength(3);

    const tr1 = (contents![0] as { toolResult: Record<string, unknown> }).toolResult;
    const tr2 = (contents![1] as { toolResult: Record<string, unknown> }).toolResult;
    const tr3 = (contents![2] as { toolResult: Record<string, unknown> }).toolResult;

    expect(tr1.status).toBe("error");
    expect(tr2.status).toBeUndefined();
    expect(tr3.status).toBe("error");
  });
});
