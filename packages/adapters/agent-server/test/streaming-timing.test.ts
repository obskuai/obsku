import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AgentEvent, LLMProvider } from "@obsku/framework";
import { serve } from "../src/index";

const mockProvider: LLMProvider = {
  chat: async () => ({
    content: [{ text: "mock", type: "text" }],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 5 },
  }),
  chatStream: async function* () {
    yield { content: "mock", type: "text_delta" };
    yield { stopReason: "end_turn", type: "message_end", usage: { inputTokens: 10, outputTokens: 5 } };
  },
  contextWindowSize: 8192,
};

const delayedChunkAgent = {
  name: "delayed-chunk-agent",
  run: async (_input: string, _provider: LLMProvider, options?: { onEvent?: (event: AgentEvent) => void }): Promise<string> => {
    if (options?.onEvent) {
      for (let i = 0; i < 10; i++) {
        await Bun.sleep(50);
        options.onEvent({
          content: `chunk-${i} `,
          phase: "summarizing",
          timestamp: Date.now(),
          type: "stream.chunk",
        });
      }
    }
    return "delayed response";
  },
};

describe("Streaming timing verification", () => {
  let server: ReturnType<typeof serve>;
  const testPort = 19_020;

  beforeAll(() => {
    server = serve(delayedChunkAgent, mockProvider, {
      description: "Timing test agent",
      port: testPort,
      skills: ["streaming"],
    });
  });

  afterAll(() => {
    server.stop();
  });

  it("should deliver chunks progressively, not batched at the end", async () => {
    const res = await fetch(`http://localhost:${testPort}/`, {
      body: JSON.stringify({
        id: "timing-test",
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            parts: [{ kind: "text", text: "test" }],
            role: "user",
          },
        },
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunkArrivalTimes: Array<number> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const dataLines = text.split("\n").filter(l => l.startsWith("data: "));
      if (dataLines.length > 0) {
        chunkArrivalTimes.push(Date.now());
      }
    }

    expect(chunkArrivalTimes.length).toBeGreaterThanOrEqual(10);

    const firstArrival = chunkArrivalTimes[0];
    const lastArrival = chunkArrivalTimes[chunkArrivalTimes.length - 1];
    const arrivalSpread = lastArrival - firstArrival;

    expect(arrivalSpread).toBeGreaterThan(200);
  });

  it("should have first chunk arrive within reasonable time after stream starts", async () => {
    const res = await fetch(`http://localhost:${testPort}/`, {
      body: JSON.stringify({
        id: "first-chunk-timing",
        jsonrpc: "2.0",
        method: "message/stream",
        params: {
          message: {
            parts: [{ kind: "text", text: "test" }],
            role: "user",
          },
        },
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(res.body).not.toBeNull();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const requestStart = Date.now();
    let firstChunkTime: number | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const hasChunkData = text.split("\n").some(l => l.startsWith("data: ") && l.includes("chunk-"));
      if (hasChunkData && firstChunkTime === null) {
        firstChunkTime = Date.now();
      }
    }

    expect(firstChunkTime).not.toBeNull();
    const timeToFirstChunk = firstChunkTime! - requestStart;
    expect(timeToFirstChunk).toBeLessThan(800);
  });
});
