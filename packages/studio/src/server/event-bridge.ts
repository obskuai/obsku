import type {
  AgentEvent,
  AgentEventType,
  DefaultPublicPayload,
  EventBusService,
  SessionEndEvent,
  SessionStartEvent,
} from "@obsku/framework";
import type { EventDisplayInfo, SessionDisplayStatus } from "../shared/types.js";

export const MAX_EVENTS_PER_SESSION = 1000;

export type EventBroadcastHandler = (event: EventDisplayInfo) => void;

interface SessionInfo {
  id: string;
  title: string;
  createdAt: number;
  runtimeModel?: string;
  updatedAt: number;
  status: SessionDisplayStatus;
  messageCount: number;
}

interface StoredEvent {
  displayInfo: EventDisplayInfo;
  receivedAt: number;
}

export interface EventQueryFilters {
  eventTypes?: AgentEventType[];
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

export interface EventQueryResult {
  events: EventDisplayInfo[];
  total: number;
  offset: number;
  limit: number;
}

export class EventBridge {
  private sessionBuffers = new Map<string, StoredEvent[]>();
  private sessions = new Map<string, SessionInfo>();
  private broadcastHandlers = new Set<EventBroadcastHandler>();
  private eventBusSubscription?: AsyncIterable<AgentEvent>;
  private isRunning = false;
  private maxEventsPerSession: number;

  constructor(options: { maxEventsPerSession?: number } = {}) {
    this.maxEventsPerSession = options.maxEventsPerSession ?? MAX_EVENTS_PER_SESSION;
  }

  async start(eventBus: EventBusService): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    this.eventBusSubscription = eventBus.subscribe();

    this.consumeEvents().catch((error) => {
      console.error("[EventBridge] Error consuming events:", error);
    });
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.broadcastHandlers.clear();
  }

  subscribe(handler: EventBroadcastHandler): () => void {
    this.broadcastHandlers.add(handler);
    return () => {
      this.broadcastHandlers.delete(handler);
    };
  }

  getSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  queryEvents(sessionId: string, filters: EventQueryFilters = {}): EventQueryResult {
    const buffer = this.sessionBuffers.get(sessionId);
    if (!buffer) {
      return { events: [], total: 0, offset: filters.offset ?? 0, limit: filters.limit ?? 0 };
    }

    let events = buffer.map((se) => se.displayInfo);

    if (filters.eventTypes?.length) {
      events = events.filter((e) => filters.eventTypes!.includes(e.type as AgentEventType));
    }

    if (filters.startTime !== undefined) {
      events = events.filter((e) => e.timestamp >= filters.startTime!);
    }
    if (filters.endTime !== undefined) {
      events = events.filter((e) => e.timestamp <= filters.endTime!);
    }

    const total = events.length;
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? total;
    events = events.slice(offset, offset + limit);

    return { events, total, offset, limit };
  }

  getLatestEvents(sessionId: string, count: number): EventDisplayInfo[] {
    const buffer = this.sessionBuffers.get(sessionId);
    if (!buffer) return [];
    return buffer.slice(-count).map((se) => se.displayInfo);
  }

  getEventCount(sessionId: string): number {
    return this.sessionBuffers.get(sessionId)?.length ?? 0;
  }

  clear(): void {
    this.sessionBuffers.clear();
    this.sessions.clear();
  }

  clearSession(sessionId: string): boolean {
    const hadSession = this.sessionBuffers.has(sessionId);
    this.sessionBuffers.delete(sessionId);
    this.sessions.delete(sessionId);
    return hadSession;
  }

  async recordEvent(event: AgentEvent | DefaultPublicPayload<AgentEvent>): Promise<void> {
    await this.handleEvent(normalizeEvent(event));
  }

  private async consumeEvents(): Promise<void> {
    if (!this.eventBusSubscription) return;

    try {
      for await (const event of this.eventBusSubscription) {
        if (!this.isRunning) break;
        await this.handleEvent(event);
      }
    } catch (error) {
      if (this.isRunning) {
        console.error("[EventBridge] Event consumption error:", error);
      }
    }
  }

  private async handleEvent(event: AgentEvent): Promise<void> {
    const displayInfo = this.toDisplayInfo(event);
    const sessionId = this.extractSessionId(event);

    if (!sessionId) {
      this.broadcast(displayInfo);
      return;
    }

    this.handleSessionLifecycle(event, sessionId);
    this.storeEvent(sessionId, displayInfo);
    this.broadcast(displayInfo);
    this.updateSessionMetadata(sessionId, event.type);
  }

  private handleSessionLifecycle(event: AgentEvent, sessionId: string): void {
    if (event.type === "session.start") {
      const startEvent = event as SessionStartEvent;
      const now = Date.now();
      this.sessions.set(sessionId, {
        id: sessionId,
        title: startEvent.input?.slice(0, 100) ?? `Session ${sessionId.slice(0, 8)}`,
        createdAt: startEvent.timestamp ?? now,
        runtimeModel: this.extractRuntimeModel(event),
        updatedAt: now,
        status: "active",
        messageCount: 0,
      });
    } else if (event.type === "session.end") {
      const endEvent = event as SessionEndEvent;
      const session = this.sessions.get(sessionId);
      if (session) {
        session.runtimeModel ??= this.extractRuntimeModel(event);
        session.status = this.mapSessionStatus(endEvent.status);
        session.updatedAt = Date.now();
        if (endEvent.turns !== undefined) {
          session.messageCount = endEvent.turns;
        }
      }
    }
  }

  private mapSessionStatus(status?: "complete" | "failed" | "interrupted"): SessionDisplayStatus {
    switch (status) {
      case "complete":
        return "completed";
      case "failed":
        return "failed";
      case "interrupted":
        return "interrupted";
      default:
        return "completed";
    }
  }

  private storeEvent(sessionId: string, displayInfo: EventDisplayInfo): void {
    let buffer = this.sessionBuffers.get(sessionId);
    if (!buffer) {
      buffer = [];
      this.sessionBuffers.set(sessionId, buffer);
    }

    buffer.push({ displayInfo, receivedAt: Date.now() });

    if (buffer.length > this.maxEventsPerSession) {
      buffer.splice(0, buffer.length - this.maxEventsPerSession);
    }
  }

  private updateSessionMetadata(sessionId: string, eventType: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.updatedAt = Date.now();
    if (eventType !== "session.end") {
      session.messageCount++;
    }
  }

  private broadcast(event: EventDisplayInfo): void {
    for (const handler of this.broadcastHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error("[EventBridge] Broadcast handler error:", error);
      }
    }
  }

  private extractSessionId(event: AgentEvent): string | undefined {
    if ("sessionId" in event && event.sessionId) {
      return event.sessionId;
    }
    return undefined;
  }

  private toDisplayInfo(event: AgentEvent): EventDisplayInfo {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event)) {
      if (key !== "timestamp" && key !== "type") {
        data[key] = value;
      }
    }

    return {
      type: event.type,
      category: this.categorizeEvent(event.type),
      timestamp: event.timestamp ?? Date.now(),
      agent: this.extractAgentName(event),
      data,
      severity: this.determineSeverity(event.type, event),
      sessionId: this.extractSessionId(event),
      turnId: this.extractTurnId(event),
    };
  }

  private categorizeEvent(type: string): EventDisplayInfo["category"] {
    if (type.startsWith("session.")) return "session";
    if (type.startsWith("turn.")) return "session";
    if (type.startsWith("stream.")) return "stream";
    if (type.startsWith("agent.")) return "agent";
    if (type.startsWith("tool.")) return "tool";
    if (type.startsWith("graph.")) return "graph";
    if (type.startsWith("background.")) return "background";
    if (type.startsWith("checkpoint.")) return "checkpoint";
    if (type.startsWith("memory.")) return "checkpoint";
    if (type.startsWith("guardrail.")) return "guardrail";
    if (type.startsWith("handoff.")) return "handoff";
    if (type.startsWith("supervisor.")) return "supervisor";
    if (type.startsWith("context.")) return "context";
    if (type.startsWith("error.")) return "error";
    return "agent";
  }

  private determineSeverity(type: string, event: AgentEvent): EventDisplayInfo["severity"] {
    if (type.includes("error") || type.includes("failed") || type.includes("blocked")) {
      return "error";
    }
    if (type.includes("complete") || type.includes("success")) {
      return "success";
    }
    if (type.includes("warning") || type.includes("timeout")) {
      return "warning";
    }
    return "info";
  }

  private extractAgentName(event: AgentEvent): string | undefined {
    if ("agent" in event && typeof event.agent === "string") {
      return event.agent;
    }
    if ("agentName" in event && typeof event.agentName === "string") {
      return event.agentName;
    }
    return undefined;
  }

  private extractTurnId(event: AgentEvent): string | undefined {
    if ("turnId" in event && typeof event.turnId === "string") {
      return event.turnId;
    }
    return undefined;
  }

  private extractRuntimeModel(event: AgentEvent): string | undefined {
    if ("runtimeModel" in event && typeof event.runtimeModel === "string") {
      return event.runtimeModel;
    }
    return undefined;
  }
}

function normalizeEvent(event: AgentEvent | DefaultPublicPayload<AgentEvent>): AgentEvent {
  if ("data" in event && typeof event.data === "object" && event.data !== null) {
    const { data, ...rest } = event;
    return { ...rest, ...data } as AgentEvent;
  }

  return event as AgentEvent;
}

export const eventBridge = new EventBridge();

export function createEventBridge(options?: { maxEventsPerSession?: number }): EventBridge {
  return new EventBridge(options);
}
