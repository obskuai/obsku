import { describe, expect, it } from "bun:test";
import type {
  AgentEvent,
  EventBusService,
  SessionStartEvent,
  SessionEndEvent,
  AgentThinkingEvent,
  ToolCallEvent,
} from "@obsku/framework";
import {
  createEventBridge,
  MAX_EVENTS_PER_SESSION,
} from "../../src/server/event-bridge.js";

function createMockEventBus(): EventBusService {
  const subscribers: ((event: AgentEvent) => void)[] = [];

  return {
    capacity: 100,
    sessionId: undefined,
    publish: async (event: AgentEvent) => {
      subscribers.forEach((sub) => sub(event));
      return true;
    },
    publishAll: async (events: AgentEvent[]) => {
      events.forEach((event) => subscribers.forEach((sub) => sub(event)));
      return true;
    },
    subscribe: () => {
      const eventQueue: AgentEvent[] = [];
      let resolveNext: ((value: IteratorResult<AgentEvent>) => void) | null = null;

      const pushEvent = (event: AgentEvent) => {
        if (resolveNext) {
          resolveNext({ value: event, done: false });
          resolveNext = null;
        } else {
          eventQueue.push(event);
        }
      };

      subscribers.push(pushEvent);

      return {
        [Symbol.asyncIterator]: () => ({
          next: async (): Promise<IteratorResult<AgentEvent>> => {
            if (eventQueue.length > 0) {
              return { value: eventQueue.shift()!, done: false };
            }
            return new Promise((resolve) => {
              resolveNext = resolve;
            });
          },
        }),
      } as AsyncIterable<AgentEvent>;
    },
    destroy: async () => {
      subscribers.length = 0;
    },
  };
}

function createSessionStartEvent(
  sessionId: string,
  input?: string,
  timestamp?: number,
  runtimeModel?: string,
  runtimeProvider?: string
): SessionStartEvent {
  return {
    type: "session.start",
    sessionId,
    input,
    timestamp: timestamp ?? Date.now(),
    runtimeModel,
    runtimeProvider,
  };
}

function createSessionEndEvent(
  sessionId: string,
  status?: "complete" | "failed" | "interrupted",
  turns?: number,
  timestamp?: number
): SessionEndEvent {
  return {
    type: "session.end",
    sessionId,
    status,
    turns,
    timestamp: timestamp ?? Date.now(),
  };
}

function createAgentThinkingEvent(
  sessionId: string,
  agent: string,
  timestamp?: number
): AgentThinkingEvent {
  return {
    type: "agent.thinking",
    sessionId,
    agent,
    content: "thinking...",
    timestamp: timestamp ?? Date.now(),
  };
}

function createToolCallEvent(
  sessionId: string,
  toolName: string,
  timestamp?: number
): ToolCallEvent {
  return {
    type: "tool.call",
    sessionId,
    tool: toolName,
    params: {},
    timestamp: timestamp ?? Date.now(),
  };
}

describe("EventBridge", () => {
  describe("session lifecycle tracking", () => {
    it("should create session on session.start event", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-1";
      const event = createSessionStartEvent(sessionId, "Hello world");
      await eventBus.publish(event);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const session = bridge.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session!.id).toBe(sessionId);
      expect(session!.status).toBe("active");
      expect(session!.title).toBe("Hello world");

      await bridge.stop();
    });

    it("should update session status on session.end event", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-2";
      await eventBus.publish(createSessionStartEvent(sessionId));
      await eventBus.publish(createSessionEndEvent(sessionId, "complete", 5));

      await new Promise((resolve) => setTimeout(resolve, 10));

      const session = bridge.getSession(sessionId);
      expect(session!.status).toBe("completed");
      expect(session!.messageCount).toBe(5);

      await bridge.stop();
    });

    it("should handle failed session status", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-3";
      await eventBus.publish(createSessionStartEvent(sessionId));
      await eventBus.publish(createSessionEndEvent(sessionId, "failed"));

      await new Promise((resolve) => setTimeout(resolve, 10));

      const session = bridge.getSession(sessionId);
      expect(session!.status).toBe("failed");

      await bridge.stop();
    });

    it("should handle interrupted session status", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-4";
      await eventBus.publish(createSessionStartEvent(sessionId));
      await eventBus.publish(createSessionEndEvent(sessionId, "interrupted"));

      await new Promise((resolve) => setTimeout(resolve, 10));

      const session = bridge.getSession(sessionId);
      expect(session!.status).toBe("interrupted");

      await bridge.stop();
    });

    it("should track runtimeModel and runtimeProvider on session creation", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-runtime";
      await eventBus.publish(
        createSessionStartEvent(
          sessionId,
          "Hello",
          Date.now(),
          "claude-3-sonnet",
          "anthropic"
        )
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      const session = bridge.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session!.runtimeModel).toBe("claude-3-sonnet");
      expect(session!.runtimeProvider).toBe("anthropic");

      await bridge.stop();
    });

    it("should list all sessions sorted by updatedAt", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const now = Date.now();
      await eventBus.publish(createSessionStartEvent("session-a", "First", now));
      await new Promise((resolve) => setTimeout(resolve, 10));
      await eventBus.publish(createSessionStartEvent("session-b", "Second", now + 1));

      await new Promise((resolve) => setTimeout(resolve, 10));

      const sessions = bridge.getSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe("session-b");
      expect(sessions[1].id).toBe("session-a");

      await bridge.stop();
    });
  });

  describe("event storage", () => {
    it("should store events for a session", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-5";
      await eventBus.publish(createSessionStartEvent(sessionId));
      await eventBus.publish(createAgentThinkingEvent(sessionId, "agent-1"));
      await eventBus.publish(createToolCallEvent(sessionId, "tool-1"));

      await new Promise((resolve) => setTimeout(resolve, 10));

      const count = bridge.getEventCount(sessionId);
      expect(count).toBe(3);

      await bridge.stop();
    });

    it("should get latest events", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-6";
      await eventBus.publish(createSessionStartEvent(sessionId));
      await eventBus.publish(createAgentThinkingEvent(sessionId, "agent-1"));
      await eventBus.publish(createAgentThinkingEvent(sessionId, "agent-2"));
      await eventBus.publish(createToolCallEvent(sessionId, "tool-1"));

      await new Promise((resolve) => setTimeout(resolve, 10));

      const latest = bridge.getLatestEvents(sessionId, 2);
      expect(latest).toHaveLength(2);
      expect(latest[0].type).toBe("agent.thinking");
      expect(latest[1].type).toBe("tool.call");

      await bridge.stop();
    });

    it("should not store events without sessionId", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const eventWithoutSession: AgentEvent = {
        type: "agent.thinking",
        agent: "agent-1",
        content: "thinking...",
        timestamp: Date.now(),
      } as AgentEvent;

      await eventBus.publish(eventWithoutSession);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(bridge.getSessions()).toHaveLength(0);

      await bridge.stop();
    });
  });

  describe("event querying", () => {
    it("should query events by type", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-7";
      const now = Date.now();
      await eventBus.publish(createSessionStartEvent(sessionId, "test", now));
      await eventBus.publish(createAgentThinkingEvent(sessionId, "agent-1", now + 1));
      await eventBus.publish(createToolCallEvent(sessionId, "tool-1", now + 2));

      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = bridge.queryEvents(sessionId, {
        eventTypes: ["agent.thinking"],
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe("agent.thinking");
      expect(result.total).toBe(1);

      await bridge.stop();
    });

    it("should query events by time range", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-8";
      await eventBus.publish(createSessionStartEvent(sessionId, "test", 1000));
      await eventBus.publish(createAgentThinkingEvent(sessionId, "agent-1", 1500));
      await eventBus.publish(createToolCallEvent(sessionId, "tool-1", 2000));

      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = bridge.queryEvents(sessionId, {
        startTime: 1200,
        endTime: 1800,
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe("agent.thinking");

      await bridge.stop();
    });

    it("should support pagination with offset and limit", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-9";
      await eventBus.publish(createSessionStartEvent(sessionId));
      await eventBus.publish(createAgentThinkingEvent(sessionId, "agent-1"));
      await eventBus.publish(createAgentThinkingEvent(sessionId, "agent-2"));
      await eventBus.publish(createToolCallEvent(sessionId, "tool-1"));

      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = bridge.queryEvents(sessionId, {
        offset: 1,
        limit: 2,
      });

      expect(result.events).toHaveLength(2);
      expect(result.offset).toBe(1);
      expect(result.limit).toBe(2);
      expect(result.total).toBe(4);

      await bridge.stop();
    });

    it("should return empty result for non-existent session", () => {
      const bridge = createEventBridge();
      const result = bridge.queryEvents("non-existent");

      expect(result.events).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe("buffer eviction (LRU)", () => {
    it("should evict oldest events when exceeding max buffer size", async () => {
      const eventBus = createMockEventBus();
      const smallBufferSize = 5;
      const bridge = createEventBridge({ maxEventsPerSession: smallBufferSize });
      await bridge.start(eventBus);

      const sessionId = "test-session-10";
      await eventBus.publish(createSessionStartEvent(sessionId));

      for (let i = 0; i < 10; i++) {
        await eventBus.publish(createAgentThinkingEvent(sessionId, `agent-${i}`, i));
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      const count = bridge.getEventCount(sessionId);
      expect(count).toBe(smallBufferSize);

      const events = bridge.queryEvents(sessionId).events;
      expect(events[0].data.agent).toBe("agent-5");
      expect(events[events.length - 1].data.agent).toBe("agent-9");

      await bridge.stop();
    });

    it("should use default max buffer size", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-11";
      await eventBus.publish(createSessionStartEvent(sessionId));

      for (let i = 0; i < 10; i++) {
        await eventBus.publish(createAgentThinkingEvent(sessionId, `agent-${i}`));
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      const count = bridge.getEventCount(sessionId);
      expect(count).toBe(11);

      await bridge.stop();
    });

    it("should correctly set MAX_EVENTS_PER_SESSION constant", () => {
      expect(MAX_EVENTS_PER_SESSION).toBe(1000);
    });
  });

  describe("broadcast subscription", () => {
    it("should broadcast events to subscribers", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const receivedEvents: unknown[] = [];
      const unsubscribe = bridge.subscribe((event) => {
        receivedEvents.push(event);
      });

      const sessionId = "test-session-12";
      await eventBus.publish(createSessionStartEvent(sessionId));
      await eventBus.publish(createAgentThinkingEvent(sessionId, "agent-1"));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(receivedEvents.length).toBeGreaterThanOrEqual(2);

      unsubscribe();
      await bridge.stop();
    });

    it("should allow unsubscribing from broadcasts", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const receivedEvents: unknown[] = [];
      const unsubscribe = bridge.subscribe((event) => {
        receivedEvents.push(event);
      });

      unsubscribe();

      const sessionId = "test-session-13";
      await eventBus.publish(createSessionStartEvent(sessionId));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(receivedEvents.length).toBe(0);

      await bridge.stop();
    });
  });

  describe("clear operations", () => {
    it("should clear all sessions and events", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-14";
      await eventBus.publish(createSessionStartEvent(sessionId));
      await eventBus.publish(createAgentThinkingEvent(sessionId, "agent-1"));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(bridge.getSessions()).toHaveLength(1);
      expect(bridge.getEventCount(sessionId)).toBe(2);

      bridge.clear();

      expect(bridge.getSessions()).toHaveLength(0);
      expect(bridge.getEventCount(sessionId)).toBe(0);

      await bridge.stop();
    });

    it("should clear specific session", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      await eventBus.publish(createSessionStartEvent("session-a"));
      await eventBus.publish(createSessionStartEvent("session-b"));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(bridge.getSessions()).toHaveLength(2);

      const cleared = bridge.clearSession("session-a");

      expect(cleared).toBe(true);
      expect(bridge.getSessions()).toHaveLength(1);
      expect(bridge.getSession("session-b")).toBeDefined();

      await bridge.stop();
    });

    it("should return false when clearing non-existent session", () => {
      const bridge = createEventBridge();
      const cleared = bridge.clearSession("non-existent");
      expect(cleared).toBe(false);
    });
  });

  describe("event display info conversion", () => {
    it("should correctly categorize events", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-15";
      await eventBus.publish(createSessionStartEvent(sessionId));

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = bridge.queryEvents(sessionId).events;
      expect(events[0].category).toBe("session");

      await bridge.stop();
    });

    it("should correctly determine severity", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-16";
      await eventBus.publish(createSessionStartEvent(sessionId));

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = bridge.queryEvents(sessionId).events;
      expect(events[0].severity).toBe("info");

      await bridge.stop();
    });

    it("should extract agent name from event", async () => {
      const eventBus = createMockEventBus();
      const bridge = createEventBridge();
      await bridge.start(eventBus);

      const sessionId = "test-session-17";
      await eventBus.publish(createSessionStartEvent(sessionId));
      await eventBus.publish(createAgentThinkingEvent(sessionId, "my-agent"));

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = bridge.queryEvents(sessionId).events;
      const thinkingEvent = events.find((e) => e.type === "agent.thinking");
      expect(thinkingEvent?.agent).toBe("my-agent");

      await bridge.stop();
    });
  });
});
