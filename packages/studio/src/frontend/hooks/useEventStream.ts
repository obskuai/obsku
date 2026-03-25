import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALL_EVENT_TYPES } from "../../shared/event-types";
import type { EventDisplayInfo } from "../../shared/types";

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

type ConnectionState = "connecting" | "open" | "closed";

interface BrowserEventSource {
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  close(): void;
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
}

type BrowserEventSourceConstructor = new (url: string) => BrowserEventSource;

export interface UseEventStreamOptions {
  sessionId?: string;
}

export interface UseEventStreamResult<TEvent extends EventDisplayInfo = EventDisplayInfo> {
  events: TEvent[];
  isConnected: boolean;
  error: string | null;
  reconnect: () => void;
}

function isEventDisplayInfo(value: unknown): value is EventDisplayInfo {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<EventDisplayInfo>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.timestamp === "number" &&
    typeof candidate.category === "string" &&
    typeof candidate.severity === "string" &&
    !!candidate.data &&
    typeof candidate.data === "object"
  );
}

function getEventStreamUrl(sessionId?: string): string {
  const url = new URL("/api/events", "http://localhost");
  if (sessionId) {
    url.searchParams.set("sessionId", sessionId);
  }
  return `${url.pathname}${url.search}`;
}

export function useEventStream<TEvent extends EventDisplayInfo = EventDisplayInfo>(
  options: UseEventStreamOptions = {}
): UseEventStreamResult<TEvent> {
  const { sessionId } = options;
  const [events, setEvents] = useState<TEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const eventSourceRef = useRef<BrowserEventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const retryTokenRef = useRef(0);

  useEffect(() => {
    setEvents([]);
  }, [sessionId]);

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    setReconnectNonce((current) => current + 1);
  }, []);

  const streamUrl = useMemo(() => getEventStreamUrl(sessionId), [sessionId]);

  useEffect(() => {
    let isDisposed = false;

    const clearReconnectTimer = (): void => {
      if (reconnectTimerRef.current !== null) {
        globalThis.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const closeSource = (): void => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    const scheduleReconnect = (): void => {
      if (isDisposed || reconnectTimerRef.current !== null) {
        return;
      }

      const attempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = attempt;
      const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);

      reconnectTimerRef.current = globalThis.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    const handleIncomingEvent = (message: { data: string }): void => {
      try {
        const parsed: unknown = JSON.parse(message.data);
        if (!isEventDisplayInfo(parsed)) {
          throw new Error("Invalid SSE payload");
        }

        const typedEvent = parsed as TEvent;
        if (sessionId && typedEvent.sessionId !== sessionId) {
          return;
        }

        setEvents((current) => [...current, typedEvent]);
        setError(null);
      } catch (cause) {
        const messageText = cause instanceof Error ? cause.message : "Failed to parse SSE payload";
        setError(messageText);
      }
    };

    const connect = (): void => {
      if (isDisposed) {
        return;
      }

      clearReconnectTimer();
      closeSource();

      const retryToken = retryTokenRef.current + 1;
      retryTokenRef.current = retryToken;

      setConnectionState("connecting");

      const EventSourceCtor = (
        globalThis as typeof globalThis & {
          EventSource?: BrowserEventSourceConstructor;
        }
      ).EventSource;

      if (!EventSourceCtor) {
        setConnectionState("closed");
        setError("EventSource is not available in this environment");
        return;
      }

      const source = new EventSourceCtor(streamUrl);
      eventSourceRef.current = source as BrowserEventSource;

      source.onopen = () => {
        if (isDisposed || retryTokenRef.current !== retryToken) {
          return;
        }

        reconnectAttemptRef.current = 0;
        setConnectionState("open");
        setError(null);
      };

      source.onerror = () => {
        if (isDisposed || retryTokenRef.current !== retryToken) {
          return;
        }

        setConnectionState("closed");
        setError("Event stream disconnected");
        closeSource();
        scheduleReconnect();
      };

      source.onmessage = handleIncomingEvent;

      for (const eventType of ALL_EVENT_TYPES) {
        source.addEventListener(eventType, handleIncomingEvent);
      }
    };

    connect();

    return () => {
      isDisposed = true;
      setConnectionState("closed");
      clearReconnectTimer();
      closeSource();
    };
  }, [reconnectNonce, sessionId, streamUrl]);

  return {
    events,
    isConnected: connectionState === "open",
    error,
    reconnect,
  };
}
