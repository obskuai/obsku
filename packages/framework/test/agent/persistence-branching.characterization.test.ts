/**
 * Characterization tests for agent/persistence.ts branching logic.
 *
 * Purpose (Task 5 / Wave 1): Pin the skip/run conditions for each persistence
 * function so refactors cannot silently drop or duplicate checkpoint writes.
 *
 * Rules:
 *  - Tests are READ-ONLY observers; production source files are NOT modified.
 *  - We use Effect.runPromise to execute the Effect-based functions.
 *  - Spy counters track whether storage functions were invoked.
 */

import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
  persistMemoryHooks,
  persistResults,
  persistToCheckpointStore,
  persistToLegacyMemory,
} from "../../src/agent/persistence";
import type { CheckpointStore, StoredMessage } from "../../src/checkpoint/types";
import type { MemoryHookContext } from "../../src/memory/types";
import type {
  AgentDef,
  AgentEvent,
  LLMProvider,
  MemoryConfig,
  Message,
} from "../../src/types/index";

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

function noopEmit(_event: AgentEvent): Effect.Effect<boolean> {
  return Effect.succeed(true);
}

function minimalDef(overrides: Partial<AgentDef> = {}): AgentDef {
  return {
    name: "test-agent",
    prompt: "test",
    ...overrides,
  };
}

function minimalProvider(): LLMProvider {
  return {
    chat: async () => ({
      content: [{ text: "ok", type: "text" }],
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
    chatStream: async function* () {},
    contextWindowSize: 1000,
  };
}

/** A minimal CheckpointStore that records invocations. */
function makeSpyStore(): {
  addMessageCalls: number;
  getSessionCalls: number;
  store: CheckpointStore;
} {
  const state = { addMessageCalls: 0, getSessionCalls: 0 };

  const stubSession: Awaited<ReturnType<CheckpointStore["createSession"]>> = {
    createdAt: Date.now(),
    directory: "/tmp",
    id: "stub-session",
    updatedAt: Date.now(),
  };

  const store: CheckpointStore = {
    addMessage: async (_sessionId, message) => {
      state.addMessageCalls++;
      return {
        ...message,
        createdAt: Date.now(),
        id: state.addMessageCalls,
      } satisfies StoredMessage;
    },
    createSession: async () => stubSession,
    close: async () => {},
    deleteSession: async () => {},
    fork: async () => stubSession,
    getCheckpoint: async () => null,
    getLatestCheckpoint: async () => null,
    getMessages: async () => [],
    getSession: async () => stubSession,
    listCheckpoints: async () => [],
    listSessions: async () => [],
    saveCheckpoint: async () => ({
      createdAt: Date.now(),
      id: "cp1",
      namespace: "",
      nodeResults: {},
      pendingNodes: [],
      sessionId: "stub-session",
      source: "loop",
      step: 0,
      version: 1,
    }),
    updateSession: async () => {},
  };

  return { addMessageCalls: state.addMessageCalls, getSessionCalls: state.getSessionCalls, store };
}

function makeRecordingStore(options?: {
  createdSessionId?: string;
  existingSessionId?: string | null;
}): {
  createSessionArgs: Array<{
    directory: string;
    options?: { metadata?: Record<string, unknown>; title?: string; workspaceId?: string };
  }>;
  getSessionArgs: Array<string>;
  recordedMessages: Array<{
    message: Omit<StoredMessage, "id" | "createdAt">;
    sessionId: string;
  }>;
  store: CheckpointStore;
} {
  const createdSessionId = options?.createdSessionId ?? "created-session";
  const hasExistingSessionOverride = options !== undefined && "existingSessionId" in options;
  const resolvedExistingSessionId = hasExistingSessionOverride
    ? (options.existingSessionId ?? createdSessionId)
    : "existing-session";
  const recordedMessages: Array<{
    message: Omit<StoredMessage, "id" | "createdAt">;
    sessionId: string;
  }> = [];
  const getSessionArgs: Array<string> = [];
  const createSessionArgs: Array<{
    directory: string;
    options?: { metadata?: Record<string, unknown>; title?: string; workspaceId?: string };
  }> = [];

  const store: CheckpointStore = {
    addMessage: async (sessionId, message) => {
      recordedMessages.push({ message, sessionId });
      return {
        ...message,
        createdAt: Date.now(),
        id: recordedMessages.length,
      } satisfies StoredMessage;
    },
    close: async () => {},
    createSession: async (directory, sessionOptions) => {
      createSessionArgs.push({ directory, options: sessionOptions });
      return {
        createdAt: Date.now(),
        directory,
        id: createdSessionId,
        title: sessionOptions?.title,
        updatedAt: Date.now(),
        workspaceId: sessionOptions?.workspaceId,
      };
    },
    deleteSession: async () => {},
    fork: async () => ({
      createdAt: Date.now(),
      directory: "/tmp",
      id: createdSessionId,
      updatedAt: Date.now(),
    }),
    getCheckpoint: async () => null,
    getLatestCheckpoint: async () => null,
    getMessages: async () => [],
    getSession: async (sessionId) => {
      getSessionArgs.push(sessionId);
      if (hasExistingSessionOverride && options.existingSessionId === null) {
        return null;
      }

      return {
        createdAt: Date.now(),
        directory: "/tmp/existing",
        id: resolvedExistingSessionId,
        updatedAt: Date.now(),
      };
    },
    listCheckpoints: async () => [],
    listSessions: async () => [],
    saveCheckpoint: async () => ({
      createdAt: Date.now(),
      id: "cp1",
      namespace: "",
      nodeResults: {},
      pendingNodes: [],
      sessionId: createdSessionId,
      source: "loop",
      step: 0,
      version: 1,
    }),
    updateSession: async () => {},
  };

  return { createSessionArgs, getSessionArgs, recordedMessages, store };
}

const EMPTY_MESSAGES: Array<Message> = [];
const TEXT_MESSAGES: Array<Message> = [
  { content: [{ text: "user-input", type: "text" }], role: "user" },
  { content: [{ text: "assistant-output", type: "text" }], role: "assistant" },
];

// ---------------------------------------------------------------------------
// persistToCheckpointStore — skip conditions (negative paths)
// ---------------------------------------------------------------------------

describe("persistToCheckpointStore skip conditions characterization", () => {
  it("skips all writes when checkpointStore is undefined", async () => {
    let emitCount = 0;
    const emit = (_e: AgentEvent): Effect.Effect<boolean> => {
      emitCount++;
      return Effect.succeed(true);
    };

    await Effect.runPromise(
      persistToCheckpointStore(
        undefined, // no store
        "some-session",
        EMPTY_MESSAGES,
        minimalDef(),
        "prompt",
        [],
        "input",
        emit
      )
    );

    // Pin: no emit (no memory.save event) when there's no store
    expect(emitCount).toBe(0);
  });

  it("skips all writes when sessionId is undefined", async () => {
    let emitCount = 0;
    const { store } = makeSpyStore();
    const emit = (_e: AgentEvent): Effect.Effect<boolean> => {
      emitCount++;
      return Effect.succeed(true);
    };

    await Effect.runPromise(
      persistToCheckpointStore(
        store,
        undefined, // no session
        EMPTY_MESSAGES,
        minimalDef(),
        "prompt",
        [],
        "input",
        emit
      )
    );

    // Pin: store is NOT queried and emit is NOT called when sessionId missing
    expect(emitCount).toBe(0);
  });

  it("emits memory.save event when both store and sessionId are provided", async () => {
    const events: Array<AgentEvent> = [];
    const { store } = makeSpyStore();
    const emit = (e: AgentEvent): Effect.Effect<boolean> => {
      events.push(e);
      return Effect.succeed(true);
    };

    await Effect.runPromise(
      persistToCheckpointStore(
        store,
        "stub-session",
        EMPTY_MESSAGES,
        minimalDef(),
        "prompt",
        [],
        "input",
        emit
      )
    );

    // Pin: exactly one memory.save event is emitted after writes complete
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("memory.save");
  });

  it("creates checkpoint session when requested session is missing", async () => {
    const events: Array<AgentEvent> = [];
    const { createSessionArgs, getSessionArgs, recordedMessages, store } = makeRecordingStore({
      createdSessionId: "created-from-missing-session",
      existingSessionId: null,
    });
    const checkpointMessages: Array<Message> = [
      { content: [{ text: "prompt", type: "text" }], role: "system" },
      ...TEXT_MESSAGES,
    ];

    await Effect.runPromise(
      persistToCheckpointStore(
        store,
        "missing-session",
        checkpointMessages,
        minimalDef({ name: "persist-agent" }),
        "prompt",
        [],
        "user-input",
        (event) => {
          events.push(event);
          return Effect.succeed(true);
        }
      )
    );

    expect(getSessionArgs).toEqual(["missing-session"]);
    expect(createSessionArgs).toEqual([
      {
        directory: "/tmp/agent-session",
        options: { title: "Agent: persist-agent" },
      },
    ]);
    expect(recordedMessages.map((entry) => entry.sessionId)).toEqual([
      "created-from-missing-session",
      "created-from-missing-session",
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      messageCount: checkpointMessages.length,
      sessionId: "created-from-missing-session",
      type: "memory.save",
    });
  });

  it("stores only new durable messages and excludes duplicate input plus transient memory", async () => {
    const events: Array<AgentEvent> = [];
    const { recordedMessages, store } = makeRecordingStore({
      existingSessionId: "persisted-session",
    });
    const history: Array<Message> = [
      { content: [{ text: "prior-user", type: "text" }], role: "user" },
      { content: [{ text: "prior-assistant", type: "text" }], role: "assistant" },
    ];
    const messages: Array<Message> = [
      { content: [{ text: "prompt", type: "text" }], role: "system" },
      ...history,
      {
        __obskuTransientMemoryInjection: true,
        content: [{ text: "## Memory Context\nremembered fact", type: "text" }],
        role: "user",
      } as Message,
      { content: [{ text: "user-input", type: "text" }], role: "user" },
      { content: [{ text: "assistant-output", type: "text" }], role: "assistant" },
    ];

    await Effect.runPromise(
      persistToCheckpointStore(
        store,
        "persisted-session",
        messages,
        minimalDef(),
        "prompt",
        history,
        "user-input",
        (event) => {
          events.push(event);
          return Effect.succeed(true);
        }
      )
    );

    expect(recordedMessages).toHaveLength(2);
    expect(recordedMessages[0]).toMatchObject({
      message: { content: "user-input", role: "user", sessionId: "persisted-session" },
      sessionId: "persisted-session",
    });
    expect(recordedMessages[1]).toMatchObject({
      message: { content: "assistant-output", role: "assistant", sessionId: "persisted-session" },
      sessionId: "persisted-session",
    });
    expect(
      recordedMessages.some((entry) => entry.message.content?.includes("Memory Context"))
    ).toBe(false);
    expect(events[0]).toMatchObject({
      messageCount: messages.length,
      sessionId: "persisted-session",
      type: "memory.save",
    });
  });
});

// ---------------------------------------------------------------------------
// persistToLegacyMemory — skip conditions (negative paths)
// ---------------------------------------------------------------------------

describe("persistToLegacyMemory skip conditions characterization", () => {
  it("skips when checkpointStore is provided (legacy memory is bypassed)", async () => {
    let emitCount = 0;
    const { store } = makeSpyStore();
    const legacyMemory = {
      load: async () => [],
      save: async () => {
        emitCount = 99; // should never be called
      },
    };
    const emit = (): Effect.Effect<boolean> => {
      emitCount++;
      return Effect.succeed(true);
    };

    await Effect.runPromise(
      persistToLegacyMemory(
        store, // checkpointStore present → legacy is skipped
        "some-session",
        EMPTY_MESSAGES,
        minimalDef({ memory: legacyMemory }),
        emit
      )
    );

    // Pin: checkpointStore takes precedence over legacy MemoryProvider
    expect(emitCount).toBe(0);
  });

  it("skips when sessionId is undefined", async () => {
    let saveCalled = false;
    const legacyMemory = {
      load: async () => [],
      save: async () => {
        saveCalled = true;
      },
    };

    await Effect.runPromise(
      persistToLegacyMemory(
        undefined,
        undefined, // no session
        EMPTY_MESSAGES,
        minimalDef({ memory: legacyMemory }),
        noopEmit
      )
    );

    expect(saveCalled).toBe(false);
  });

  it("skips when def.memory is undefined", async () => {
    let emitCount = 0;

    await Effect.runPromise(
      persistToLegacyMemory(
        undefined,
        "some-session",
        EMPTY_MESSAGES,
        minimalDef(), // no memory property
        () => {
          emitCount++;
          return Effect.succeed(true);
        }
      )
    );

    expect(emitCount).toBe(0);
  });

  it("skips when def.memory is a MemoryConfig (not a MemoryProvider)", async () => {
    // MemoryConfig has { enabled, store, ... } but NOT { load, save }
    const memoryConfig: MemoryConfig = {
      enabled: true,
      store: {} as never,
    };

    let emitCount = 0;

    await Effect.runPromise(
      persistToLegacyMemory(
        undefined,
        "some-session",
        EMPTY_MESSAGES,
        minimalDef({ memory: memoryConfig }),
        () => {
          emitCount++;
          return Effect.succeed(true);
        }
      )
    );

    // Pin: MemoryConfig (without load/save methods) is NOT treated as MemoryProvider
    expect(emitCount).toBe(0);
  });

  it("executes and emits when no checkpointStore, sessionId present, and def.memory is MemoryProvider", async () => {
    const events: Array<AgentEvent> = [];
    let saveCalled = false;

    const legacyMemory = {
      load: async () => [],
      save: async () => {
        saveCalled = true;
      },
    };

    await Effect.runPromise(
      persistToLegacyMemory(
        undefined, // no checkpoint store → legacy path runs
        "some-session",
        EMPTY_MESSAGES,
        minimalDef({ memory: legacyMemory }),
        (e) => {
          events.push(e);
          return Effect.succeed(true);
        }
      )
    );

    // Pin: save() is called AND a memory.save event is emitted
    expect(saveCalled).toBe(true);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("memory.save");
  });
});

// ---------------------------------------------------------------------------
// persistMemoryHooks — skip conditions (negative paths)
// ---------------------------------------------------------------------------

describe("persistMemoryHooks skip conditions characterization", () => {
  it("skips when memoryConfig is undefined", async () => {
    let emitCount = 0;

    await Effect.runPromise(
      persistMemoryHooks(
        "some-session",
        EMPTY_MESSAGES,
        minimalDef(),
        "input",
        () => {
          emitCount++;
          return Effect.succeed(true);
        },
        undefined, // no memoryConfig
        minimalProvider()
      )
    );

    expect(emitCount).toBe(0);
  });

  it("skips when memoryConfig.enabled is false", async () => {
    let emitCount = 0;
    const config: MemoryConfig = { enabled: false, store: {} as never };

    await Effect.runPromise(
      persistMemoryHooks(
        "some-session",
        EMPTY_MESSAGES,
        minimalDef(),
        "input",
        () => {
          emitCount++;
          return Effect.succeed(true);
        },
        config,
        minimalProvider()
      )
    );

    // Pin: disabled memoryConfig means no hook execution
    expect(emitCount).toBe(0);
  });

  it("skips when memoryConfig.store is undefined", async () => {
    let emitCount = 0;
    const config: MemoryConfig = { enabled: true }; // no store

    await Effect.runPromise(
      persistMemoryHooks(
        "some-session",
        EMPTY_MESSAGES,
        minimalDef(),
        "input",
        () => {
          emitCount++;
          return Effect.succeed(true);
        },
        config,
        minimalProvider()
      )
    );

    // Pin: store must be present for hooks to run
    expect(emitCount).toBe(0);
  });

  it("skips when sessionId is undefined", async () => {
    let emitCount = 0;
    const config: MemoryConfig = { enabled: true, store: {} as never };

    await Effect.runPromise(
      persistMemoryHooks(
        undefined, // no sessionId
        EMPTY_MESSAGES,
        minimalDef(),
        "input",
        () => {
          emitCount++;
          return Effect.succeed(true);
        },
        config,
        minimalProvider()
      )
    );

    // Pin: sessionId is required for memory hooks
    expect(emitCount).toBe(0);
  });

  it("executes configured hook and emits memory.save with hook session metadata", async () => {
    const events: Array<AgentEvent> = [];
    let seenCtx: { input?: string; messageCount: number; sessionId: string } | undefined;
    const config: MemoryConfig = {
      enabled: true,
      hooks: {
        onMemorySave: async (ctx: MemoryHookContext) => {
          seenCtx = {
            input: ctx.input,
            messageCount: ctx.messages.length,
            sessionId: ctx.sessionId,
          };
        },
      },
      store: {} as never,
    };

    await Effect.runPromise(
      persistMemoryHooks(
        "hook-session",
        TEXT_MESSAGES,
        minimalDef({ name: "hook-agent" }),
        "user-input",
        (event) => {
          events.push(event);
          return Effect.succeed(true);
        },
        config,
        minimalProvider()
      )
    );

    expect(seenCtx).toEqual({
      input: "user-input",
      messageCount: TEXT_MESSAGES.length,
      sessionId: "hook-session",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      messageCount: TEXT_MESSAGES.length,
      sessionId: "hook-session",
      type: "memory.save",
    });
  });
});

describe("persistResults branching characterization", () => {
  it("prefers checkpoint persistence over legacy memory provider", async () => {
    const events: Array<AgentEvent> = [];
    let legacySaveCalled = false;
    const { store } = makeSpyStore();
    const legacyMemory = {
      load: async () => [],
      save: async () => {
        legacySaveCalled = true;
      },
    };

    await Effect.runPromise(
      persistResults({
        checkpointStore: store,
        def: minimalDef({ memory: legacyMemory }),
        effectivePrompt: "prompt",
        emit: (event) => {
          events.push(event);
          return Effect.succeed(true);
        },
        history: EMPTY_MESSAGES,
        input: "input",
        memoryConfig: undefined,
        messages: EMPTY_MESSAGES,
        provider: minimalProvider(),
        sessionId: "stub-session",
      })
    );

    expect(legacySaveCalled).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("memory.save");
  });

  it("runs memory hooks independently after legacy persistence when enabled", async () => {
    const events: Array<AgentEvent> = [];
    let legacySaveCalled = false;
    let hookSaveCalled = false;
    const legacyMemory = {
      load: async () => [],
      save: async () => {
        legacySaveCalled = true;
      },
    };
    const memoryConfig: MemoryConfig = {
      enabled: true,
      hooks: {
        onMemorySave: async () => {
          hookSaveCalled = true;
        },
      },
      store: {} as never,
    };

    await Effect.runPromise(
      persistResults({
        checkpointStore: undefined,
        def: minimalDef({ memory: legacyMemory }),
        effectivePrompt: "prompt",
        emit: (event) => {
          events.push(event);
          return Effect.succeed(true);
        },
        history: EMPTY_MESSAGES,
        input: "input",
        memoryConfig,
        messages: EMPTY_MESSAGES,
        provider: minimalProvider(),
        sessionId: "legacy-session",
      })
    );

    expect(legacySaveCalled).toBe(true);
    expect(hookSaveCalled).toBe(true);
    expect(events.filter((event) => event.type === "memory.save")).toHaveLength(2);
  });

  it("runs checkpoint persistence and memory hooks independently when both are enabled", async () => {
    const events: Array<AgentEvent> = [];
    let hookSaveCalled = false;
    const { recordedMessages, store } = makeRecordingStore({
      existingSessionId: "checkpoint-session",
    });
    const checkpointMessages: Array<Message> = [
      { content: [{ text: "prompt", type: "text" }], role: "system" },
      { content: [{ text: "user-input", type: "text" }], role: "user" },
      { content: [{ text: "assistant-output", type: "text" }], role: "assistant" },
    ];
    const memoryConfig: MemoryConfig = {
      enabled: true,
      hooks: {
        onMemorySave: async () => {
          hookSaveCalled = true;
        },
      },
      store: {} as never,
    };

    await Effect.runPromise(
      persistResults({
        checkpointStore: store,
        def: minimalDef(),
        effectivePrompt: "prompt",
        emit: (event) => {
          events.push(event);
          return Effect.succeed(true);
        },
        history: [],
        input: "user-input",
        memoryConfig,
        messages: checkpointMessages,
        provider: minimalProvider(),
        sessionId: "checkpoint-session",
      })
    );

    expect(recordedMessages).toHaveLength(2);
    expect(hookSaveCalled).toBe(true);
    const memorySaveEvents = events.filter((event) => event.type === "memory.save");

    expect(memorySaveEvents).toHaveLength(2);
    expect(memorySaveEvents.map((event) => event.sessionId)).toEqual([
      "checkpoint-session",
      "checkpoint-session",
    ]);
  });
});
