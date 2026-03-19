import { describe, expect, it } from "bun:test";
import {
  contentBlockDelta,
  contentBlockStart,
  contentBlockStop,
  messageStart,
  messageStop,
  metadata,
  toolUseContentBlockDelta,
  toolUseContentBlockStart,
} from "../src/strands-sse";

describe("Strands SSE formatters", () => {
  it("messageStart produces correct format", () => {
    expect(messageStart()).toBe('data: {"event":{"messageStart":{"role":"assistant"}}}\n\n');
  });

  it("contentBlockStart produces correct format", () => {
    expect(contentBlockStart(0)).toBe(
      'data: {"event":{"contentBlockStart":{"contentBlockIndex":0,"start":{"text":""}}}}\n\n'
    );
  });

  it("contentBlockDelta produces correct format", () => {
    expect(contentBlockDelta(0, "hello")).toBe(
      'data: {"event":{"contentBlockDelta":{"contentBlockIndex":0,"delta":{"text":"hello"}}}}\n\n'
    );
  });

  it("contentBlockStop produces correct format", () => {
    expect(contentBlockStop(0)).toBe(
      'data: {"event":{"contentBlockStop":{"contentBlockIndex":0}}}\n\n'
    );
  });

  it("messageStop produces correct format", () => {
    expect(messageStop("end_turn")).toBe(
      'data: {"event":{"messageStop":{"stopReason":"end_turn"}}}\n\n'
    );
  });

  it("metadata produces correct format", () => {
    expect(metadata({ inputTokens: 5, outputTokens: 10, totalTokens: 15 })).toBe(
      'data: {"event":{"metadata":{"usage":{"inputTokens":5,"outputTokens":10,"totalTokens":15}}}}\n\n'
    );
  });

  it("toolUseContentBlockStart produces correct format", () => {
    expect(toolUseContentBlockStart(1, "tu-abc", "search")).toBe(
      'data: {"event":{"contentBlockStart":{"contentBlockIndex":1,"start":{"toolUse":{"name":"search","toolUseId":"tu-abc"}}}}}\n\n'
    );
  });

  it("toolUseContentBlockDelta produces correct format", () => {
    expect(toolUseContentBlockDelta(1, '{"query":"test"}')).toBe(
      'data: {"event":{"contentBlockDelta":{"contentBlockIndex":1,"delta":{"toolUse":{"input":"{\\"query\\":\\"test\\"}"}}}}}\n\n'
    );
  });
});
