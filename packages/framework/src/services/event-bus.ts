import { Context, Effect, Exit, Layer, PubSub, Queue, Scope } from "effect";
import { DEFAULTS } from "../defaults";
import { getErrorMessage } from "../error-utils";
import { telemetryLog } from "../telemetry/log";
import type { AgentEvent } from "../types";

export interface EventBusOptions {
  readonly capacity?: number;
  readonly sessionId?: string;
}

interface ManagedEventBusOptions extends EventBusOptions {
  readonly onDestroy?: () => void;
}

export interface EventBusService {
  readonly capacity: number;
  readonly destroy: () => Promise<void>;
  readonly publish: (event: AgentEvent) => Effect.Effect<boolean>;
  readonly publishAll: (events: Array<AgentEvent>) => Effect.Effect<boolean>;
  readonly sessionId?: string;
  readonly subscribe: () => AsyncIterable<AgentEvent>;
}

export class EventBus extends Context.Tag("@obsku/EventBus")<EventBus, EventBusService>() {}

class ManagedEventBus implements EventBusService {
  private destroyed = false;
  private readonly subscriptionScopes = new Set<Scope.CloseableScope>();

  constructor(
    private readonly pubsub: PubSub.PubSub<AgentEvent>,
    readonly sessionId: string | undefined,
    readonly capacity: number,
    private readonly onDestroy?: () => void
  ) {}

  readonly destroy = async () => {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.onDestroy?.();

    const scopes = [...this.subscriptionScopes];
    this.subscriptionScopes.clear();

    await Promise.all(
      scopes.map((scope) => Effect.runPromise(Scope.close(scope, Exit.succeed(void 0))))
    );
  };

  readonly publish = (event: AgentEvent) =>
    this.destroyed ? Effect.succeed(false) : PubSub.publish(this.pubsub, event);

  readonly publishAll = (events: Array<AgentEvent>) =>
    this.destroyed ? Effect.succeed(false) : PubSub.publishAll(this.pubsub, events);

  readonly subscribe = () =>
    this.destroyed
      ? emptyAsyncIterable<AgentEvent>()
      : subscribeToAsyncIterable(this.pubsub, {
          onClose: (scope) => {
            this.subscriptionScopes.delete(scope);
          },
          onOpen: (scope) => {
            this.subscriptionScopes.add(scope);
          },
        });
}

function normalizeCapacity(capacity: number | undefined): number {
  const resolved = capacity ?? DEFAULTS.eventBusCapacity;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new RangeError(`EventBus capacity must be a positive integer, got ${String(capacity)}`);
  }
  return resolved;
}

function emptyAsyncIterable<T>(): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<T> {},
  };
}

function subscribeToAsyncIterable(
  pubsub: PubSub.PubSub<AgentEvent>,
  lifecycle?: {
    readonly onClose?: (scope: Scope.CloseableScope) => void;
    readonly onOpen?: (scope: Scope.CloseableScope) => void;
  }
): AsyncIterable<AgentEvent> {
  const scope = Effect.runSync(Scope.make());
  const subscription = Effect.runSync(Scope.extend(PubSub.subscribe(pubsub), scope));
  lifecycle?.onOpen?.(scope);

  return {
    async *[Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
      try {
        while (true) {
          try {
            yield await Effect.runPromise(Queue.take(subscription));
          } catch (error) {
            telemetryLog(`eventbus_subscribe_error: ${getErrorMessage(error)}`);
            return;
          }
        }
      } finally {
        lifecycle?.onClose?.(scope);
        await Effect.runPromise(Scope.close(scope, Exit.succeed(void 0)));
      }
    },
  };
}

const createEventBusEffect = (options?: ManagedEventBusOptions) =>
  Effect.gen(function* () {
    const capacity = normalizeCapacity(options?.capacity);
    const pubsub = yield* PubSub.sliding<AgentEvent>(capacity);

    return new ManagedEventBus(pubsub, options?.sessionId, capacity, options?.onDestroy);
  });

const sessionBusPromises = new Map<string, Promise<EventBusService>>();

export function createEventBusService(options?: EventBusOptions): Promise<EventBusService> {
  return Effect.runPromise(createEventBusEffect(options));
}

export function getSessionEventBus(
  sessionId: string,
  options?: Omit<EventBusOptions, "sessionId">
): Promise<EventBusService> {
  const existing = sessionBusPromises.get(sessionId);
  if (existing) {
    return existing;
  }

  let created: Promise<EventBusService>;
  created = Effect.runPromise(
    createEventBusEffect({
      capacity: options?.capacity,
      onDestroy: () => {
        if (sessionBusPromises.get(sessionId) === created) {
          sessionBusPromises.delete(sessionId);
        }
      },
      sessionId,
    })
  ).catch((error) => {
    sessionBusPromises.delete(sessionId);
    throw error;
  });

  sessionBusPromises.set(sessionId, created);
  return created;
}

export async function destroySessionEventBus(sessionId: string): Promise<boolean> {
  const cached = sessionBusPromises.get(sessionId);
  if (!cached) {
    return false;
  }

  const eventBus = await cached.catch((err) => {
    telemetryLog(`EventBus init failed: ${getErrorMessage(err)}`);
    return undefined;
  });
  if (!eventBus) {
    sessionBusPromises.delete(sessionId);
    return false;
  }

  await eventBus.destroy();
  return true;
}

export const EventBusLive = Layer.effect(EventBus, createEventBusEffect());
