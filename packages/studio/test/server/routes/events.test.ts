import { afterEach, describe, expect, it } from "bun:test";
import { createApp } from "../../../src/server/index.js";
import type { EventDisplayInfo } from "../../../src/shared/types.js";

class MockEventBridge {
  private handlers = new Set<(event: EventDisplayInfo) => void>();

  subscribe(handler: (event: EventDisplayInfo) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  publish(event: EventDisplayInfo): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  subscriberCount(): number {
    return this.handlers.size;
  }
}

function createTestApp(
  options: { eventBridge?: MockEventBridge; eventsHeartbeatIntervalMs?: number } = {}
) {
  return createApp({
    enableLogging: false,
    eventBridge: options.eventBridge,
    eventsHeartbeatIntervalMs: options.eventsHeartbeatIntervalMs,
  });
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>> {
  return await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (chunk: string) => boolean,
  timeoutMs = 1000
): Promise<string> {
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let output = "";

  while (Date.now() < deadline) {
    const chunk = await readWithTimeout(reader, Math.max(1, deadline - Date.now()));

    if (chunk.done) {
      break;
    }

    output += decoder.decode(chunk.value, { stream: true });

    if (predicate(output)) {
      return output;
    }
  }

  throw new Error(`Did not receive expected stream data within ${timeoutMs}ms: ${output}`);
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

const openReaders = new Set<ReadableStreamDefaultReader<Uint8Array>>();

afterEach(async () => {
  for (const reader of openReaders) {
    await reader.cancel().catch(() => undefined);
  }
  openReaders.clear();
});

describe("Events SSE Endpoint", () => {
  it("GET /api/events returns an SSE stream", async () => {
    const bridge = new MockEventBridge();
    const app = createTestApp({ eventBridge: bridge });

    const response = await app.request("http://localhost/api/events");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(bridge.subscriberCount()).toBe(1);
  });

  it("filters streamed events by sessionId query param", async () => {
    const bridge = new MockEventBridge();
    const app = createTestApp({ eventBridge: bridge });

    const response = await app.request("http://localhost/api/events?sessionId=session-a");
    const reader = response.body!.getReader();
    openReaders.add(reader);

    bridge.publish({
      type: "agent.thinking",
      category: "agent",
      timestamp: Date.now(),
      severity: "info",
      sessionId: "session-b",
      data: { content: "ignore" },
    });
    bridge.publish({
      type: "agent.thinking",
      category: "agent",
      timestamp: Date.now(),
      severity: "info",
      sessionId: "session-a",
      data: { content: "keep" },
    });

    const output = await readUntil(reader, (chunk) => chunk.includes('"sessionId":"session-a"'));

    expect(output).toContain("event: agent.thinking");
    expect(output).toContain('"content":"keep"');
    expect(output).not.toContain('"sessionId":"session-b"');
  });

  it("sends heartbeat comments on the configured interval", async () => {
    const bridge = new MockEventBridge();
    const app = createTestApp({
      eventBridge: bridge,
      eventsHeartbeatIntervalMs: 20,
    });

    const response = await app.request("http://localhost/api/events");
    const reader = response.body!.getReader();
    openReaders.add(reader);

    const output = await readUntil(reader, (chunk) => chunk.includes(": heartbeat\n\n"));

    expect(output).toContain(": heartbeat");
  });

  it("cleans up the event subscription when the client disconnects", async () => {
    const bridge = new MockEventBridge();
    const app = createTestApp({ eventBridge: bridge });

    const response = await app.request("http://localhost/api/events");
    const reader = response.body!.getReader();
    openReaders.add(reader);

    await waitFor(() => bridge.subscriberCount() === 1);

    await reader.cancel().catch(() => undefined);
    openReaders.delete(reader);

    await waitFor(() => bridge.subscriberCount() === 0);
  });
});
