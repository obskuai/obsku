import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  createEventBusService,
  destroySessionEventBus,
  EventBus,
  EventBusLive,
  type EventBusService,
  getSessionEventBus,
} from "../src/services/event-bus";
import type { AgentEvent } from "../src/types";

async function nextEvent(iterator: AsyncIterator<AgentEvent>): Promise<AgentEvent | undefined> {
  const next = await Promise.race([
    iterator.next(),
    new Promise<IteratorResult<AgentEvent>>((resolve) => {
      setTimeout(() => resolve({ done: true, value: undefined }), 250);
    }),
  ]);
  return next.done ? undefined : next.value;
}

describe("EventBus", () => {
  test("publishes and receives events through async iterable subscribe", async () => {
    const eventBus = await createEventBusService();

    // Pre-start subscription before publishing
    const sub = eventBus.subscribe();
    const iterator = sub[Symbol.asyncIterator]();

    const event: AgentEvent = {
      args: {},
      timestamp: Date.now(),
      toolName: "test-tool",
      toolUseId: "tu-1",
      type: "tool.call",
    };

    const published = await Effect.runPromise(eventBus.publish(event));
    const observed = await nextEvent(iterator);
    expect(published).toBe(true);
    expect(observed).toEqual(event);
    await iterator.return?.();
  });

  test("publishAll delivers multiple events", async () => {
    const eventBus = await createEventBusService();
    const events: Array<AgentEvent> = [
      { nodeId: "node-1", timestamp: Date.now(), type: "graph.node.start" },
      {
        duration: 100,
        nodeId: "node-1",
        result: "success",
        timestamp: Date.now(),
        type: "graph.node.complete",
      },
    ];

    // Pre-start subscription before publishing
    const sub = eventBus.subscribe();
    const iterator = sub[Symbol.asyncIterator]();

    const published = await Effect.runPromise(eventBus.publishAll(events));
    const observed: Array<AgentEvent> = [];
    for (let i = 0; i < events.length; i++) {
      const event = await nextEvent(iterator);
      if (event) observed.push(event);
    }
    expect(published).toBe(true);
    expect(observed).toEqual(events);
    await iterator.return?.();
  });

  test("uses bounded sliding behavior and drops oldest when full", async () => {
    const eventBus = await createEventBusService({ capacity: 2, sessionId: "overflow-session" });

    // Pre-start subscription before publishing
    const sub = eventBus.subscribe();
    const iterator = sub[Symbol.asyncIterator]();

    const published = await Effect.runPromise(
      eventBus.publishAll([
        { nodeId: "n1", timestamp: 1, type: "graph.node.start" },
        { nodeId: "n2", timestamp: 2, type: "graph.node.start" },
        { nodeId: "n3", timestamp: 3, type: "graph.node.start" },
      ])
    );

    const first = await nextEvent(iterator);
    const second = await nextEvent(iterator);
    const received = [first, second].filter((event): event is AgentEvent => event !== undefined);

    expect(published).toBe(true);
    expect(received.map((event) => ("nodeId" in event ? event.nodeId : undefined))).toEqual([
      "n2",
      "n3",
    ]);
    expect(eventBus.capacity).toBe(2);
    expect(eventBus.sessionId).toBe("overflow-session");
  });

  test("EventBusLive still provides service for Effect consumers", async () => {
    const program = Effect.gen(function* () {
      const eventBus = yield* EventBus;
      return eventBus.capacity;
    }).pipe(Effect.provide(EventBusLive));

    const capacity = await Effect.runPromise(program);
    expect(capacity).toBe(1024);
  });

  test("getSessionEventBus reuses the first-created session bus", async () => {
    const firstPromise = getSessionEventBus("session-cache-characterization", { capacity: 2 });
    const secondPromise = getSessionEventBus("session-cache-characterization", { capacity: 999 });

    expect(firstPromise).toBe(secondPromise);

    const [firstBus, secondBus] = await Promise.all([firstPromise, secondPromise]);
    expect(firstBus).toBe(secondBus);
    expect(firstBus.capacity).toBe(2);
    expect(firstBus.sessionId).toBe("session-cache-characterization");
  });

  test("getSessionEventBus clears failed creations so retries can recover", async () => {
    expect(
      getSessionEventBus("session-cache-retry-characterization", { capacity: 0 })
    ).rejects.toThrow("EventBus capacity must be a positive integer");

    const recovered = await getSessionEventBus("session-cache-retry-characterization", {
      capacity: 3,
    });
    expect(recovered.capacity).toBe(3);
    expect(recovered.sessionId).toBe("session-cache-retry-characterization");
  });

  test("destroySessionEventBus evicts cached bus and allows fresh recreation", async () => {
    const sessionId = "session-cache-destroy-characterization";
    const firstBus = await getSessionEventBus(sessionId, { capacity: 2 });

    expect(await destroySessionEventBus(sessionId)).toBe(true);
    expect(await destroySessionEventBus(sessionId)).toBe(false);

    const recreatedBus = await getSessionEventBus(sessionId, { capacity: 5 });
    expect(recreatedBus).not.toBe(firstBus);
    expect(recreatedBus.capacity).toBe(5);
    expect(recreatedBus.sessionId).toBe(sessionId);

    await destroySessionEventBus(sessionId);
  });

  test("repeated session create and destroy does not retain stale cached buses", async () => {
    const sessionId = "session-cache-loop-characterization";
    const seen = new Set<EventBusService>();

    for (let i = 1; i <= 3; i++) {
      const eventBus = await getSessionEventBus(sessionId, { capacity: i + 1 });
      seen.add(eventBus);
      expect(eventBus.capacity).toBe(i + 1);
      expect(await destroySessionEventBus(sessionId)).toBe(true);
    }

    expect(seen.size).toBe(3);
    expect(await destroySessionEventBus(sessionId)).toBe(false);
  });

  test("destroy closes active subscriptions and stops later publishes", async () => {
    const eventBus = await createEventBusService({ sessionId: "destroyable-session" });
    const iterator = eventBus.subscribe()[Symbol.asyncIterator]();

    await eventBus.destroy();

    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(
      await Effect.runPromise(
        eventBus.publish({ nodeId: "n1", timestamp: 1, type: "graph.node.start" })
      )
    ).toBe(false);
    eventBus.destroy();
  });
});
