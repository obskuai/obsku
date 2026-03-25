import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof document === "undefined") { try { GlobalRegistrator.register(); } catch {} }
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useEventStream } from "../../../src/frontend/hooks/useEventStream";
import { useSessionEvents } from "../../../src/frontend/hooks/useSessionEvents";
import type { EventDisplayInfo } from "../../../src/shared/types";

if (typeof document === "undefined") {
}

type EventListener = (event: { data: string }) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: EventListener | null = null;
  url: string;
  closed = false;
  closeCalls = 0;
  private listeners = new Map<string, EventListener[]>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  close(): void {
    this.closed = true;
    this.closeCalls += 1;
  }

  emit(type: string, payload: unknown): void {
    const event = { data: JSON.stringify(payload) };
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
    if (type === "message") {
      this.onmessage?.(event);
    }
  }

  emitRaw(type: string, data: string): void {
    const event = { data };
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
    if (type === "message") {
      this.onmessage?.(event);
    }
  }

  open(): void {
    this.onopen?.();
  }

  error(): void {
    this.onerror?.();
  }
}

interface ScheduledTimer {
  id: number;
  delay: number;
  callback: () => void;
}

type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

const originalEventSource = globalThis.EventSource;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

let scheduledTimers: ScheduledTimer[] = [];
let nextTimerId = 1;
const timerHandleIds = new Map<TimeoutHandle, number>();

function createEvent(overrides: Partial<EventDisplayInfo> = {}): EventDisplayInfo {
  return {
    type: "session.start",
    category: "session",
    timestamp: 123,
    data: {},
    severity: "info",
    ...overrides,
  };
}

beforeEach(() => {
  MockEventSource.instances = [];
  scheduledTimers = [];
  nextTimerId = 1;
  timerHandleIds.clear();
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.setTimeout = mock((callback: TimerHandler, delay?: number) => {
    const timer: ScheduledTimer = {
      id: nextTimerId++,
      delay: typeof delay === "number" ? delay : 0,
      callback: callback as () => void,
    };
    scheduledTimers.push(timer);
    const handle = timer.id as unknown as TimeoutHandle;
    timerHandleIds.set(handle, timer.id);
    return handle;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = mock((handle?: TimeoutHandle) => {
    const id = handle === undefined ? undefined : timerHandleIds.get(handle);
    scheduledTimers = scheduledTimers.filter((timer) => timer.id !== id);
  }) as unknown as typeof clearTimeout;
});

afterEach(() => {
  cleanup();
  globalThis.EventSource = originalEventSource;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
});

describe("useEventStream", () => {
  it("connects to the SSE endpoint and appends parsed events", () => {
    const { result } = renderHook(() => useEventStream());

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toBe("/api/events");

    act(() => {
      MockEventSource.instances[0]?.open();
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.error).toBeNull();

    const event = createEvent({ type: "agent.complete", category: "agent", severity: "success" });

    act(() => {
      MockEventSource.instances[0]?.emit("agent.complete", event);
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({
      type: "agent.complete",
      category: "agent",
      severity: "success",
      timestamp: 123,
    });
  });

  it("filters events by sessionId and encodes it in the stream URL", () => {
    const { result } = renderHook(() => useEventStream({ sessionId: "sess-1" }));

    expect(MockEventSource.instances[0]?.url).toBe("/api/events?sessionId=sess-1");

    act(() => {
      MockEventSource.instances[0]?.emit("session.start", createEvent({ sessionId: "sess-2" }));
      MockEventSource.instances[0]?.emit(
        "session.start",
        createEvent({ sessionId: "sess-1", timestamp: 456 })
      );
    });

    expect(result.current.events).toEqual([createEvent({ sessionId: "sess-1", timestamp: 456 })]);
  });

  it("reconnects with exponential backoff after disconnects", () => {
    const { result } = renderHook(() => useEventStream());

    act(() => {
      MockEventSource.instances[0]?.open();
      MockEventSource.instances[0]?.error();
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.error).toBe("Event stream disconnected");
    expect(scheduledTimers[scheduledTimers.length - 1]?.delay).toBe(1_000);

    act(() => {
      scheduledTimers[scheduledTimers.length - 1]?.callback();
    });

    expect(MockEventSource.instances).toHaveLength(2);

    act(() => {
      MockEventSource.instances[1]?.error();
    });

    expect(scheduledTimers[scheduledTimers.length - 1]?.delay).toBe(2_000);

    act(() => {
      result.current.reconnect();
    });

    expect(MockEventSource.instances).toHaveLength(3);
  });

  it("reports invalid JSON payloads and closes the stream on unmount", () => {
    const { result, unmount } = renderHook(() => useEventStream());

    act(() => {
      MockEventSource.instances[0]?.emitRaw("message", "not json");
    });

    expect(result.current.error).toBeTruthy();

    const source = MockEventSource.instances[0];
    unmount();

    expect(source?.closed).toBe(true);
    expect(source?.closeCalls).toBeGreaterThan(0);
  });
});

describe("useSessionEvents", () => {
  it("resets the event list and reconnects when the session changes", () => {
    const { result, rerender } = renderHook(({ sessionId }) => useSessionEvents(sessionId), {
      initialProps: { sessionId: "sess-1" },
    });

    act(() => {
      MockEventSource.instances[0]?.emit(
        "session.start",
        createEvent({ sessionId: "sess-1", timestamp: 1 })
      );
    });

    expect(result.current.events).toHaveLength(1);

    rerender({ sessionId: "sess-2" });

    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[0]?.closed).toBe(true);
    expect(MockEventSource.instances[1]?.url).toBe("/api/events?sessionId=sess-2");
    expect(result.current.events).toEqual([]);
  });
});
