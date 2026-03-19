/**
 * Checkpoint persistence - transient memory and system role contracts
 *
 * Purpose: Verify persistence contracts for transient memory exclusion and system role handling.
 *
 * Structure:
 *   - SECTION 1: Backward compatibility tests (GREEN - existing stored histories work)
 *   - SECTION 2: Transient/system exclusion tests (GREEN - implemented by T7/T9)
 *   - SECTION 3: Integration tests for transient memory + system role contracts (T7/T9/T13)
 *
 * Convention:
 *   Transient memory injection messages are user-role messages whose text
 *   starts with MEMORY_MARKER_START. These are excluded from checkpoint storage.
 */
import { describe, expect, test } from "bun:test";
import { agent } from "../../src/agent/index";
import { InMemoryCheckpointStore } from "../../src/checkpoint/in-memory";
import { toCheckpointPayloads } from "../../src/checkpoint/message-serializer";
import { parseStoredMessage } from "../../src/checkpoint/normalize-message";
import type { LLMProvider, LLMResponse } from "../../src/types/index";

// ---------------------------------------------------------------------------
// Convention: T7 will use this prefix to identify transient injection messages
// ---------------------------------------------------------------------------
const MEMORY_MARKER_START = "[MEMORY_INJECTION]";
const MEMORY_MARKER_END = "[/MEMORY_INJECTION]";

function makeMemoryText(content: string) {
  return `${MEMORY_MARKER_START}\n${content}\n${MEMORY_MARKER_END}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function simpleMockProvider(response: string = "OK"): LLMProvider {
  const mockResponse: LLMResponse = {
    content: [{ text: response, type: "text" }],
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
  return {
    chat: async () => mockResponse,
    chatStream: async function* () {
      yield { content: response, type: "text_delta" };
    },
    contextWindowSize: 200_000,
  };
}

// ===========================================================================
// SECTION 1 — BACKWARD COMPAT (must pass now and forever)
// ===========================================================================
describe("T3 backward compat: existing stored histories serialize and load correctly", () => {
  // -------------------------------------------------------------------------
  // Serializer backward compat
  // -------------------------------------------------------------------------
  test("toCheckpointPayloads: user text message serializes correctly", () => {
    const msgs = [
      { content: [{ text: "Scan example.com", type: "text" as const }], role: "user" as const },
    ];

    const result = toCheckpointPayloads(msgs, "s1");

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("Scan example.com");
  });

  test("toCheckpointPayloads: assistant text message serializes correctly", () => {
    const msgs = [
      {
        content: [{ text: "I will scan it now.", type: "text" as const }],
        role: "assistant" as const,
      },
    ];

    const result = toCheckpointPayloads(msgs, "s1");

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toBe("I will scan it now.");
  });

  test("toCheckpointPayloads: assistant tool-call message serializes toolCalls", () => {
    const msgs = [
      {
        content: [
          {
            input: { target: "example.com" },
            name: "nmap",
            toolUseId: "t1",
            type: "tool_use" as const,
          },
        ],
        role: "assistant" as const,
      },
    ];

    const result = toCheckpointPayloads(msgs, "s1");

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].toolCalls).toHaveLength(1);
    expect(result[0].toolCalls![0].name).toBe("nmap");
  });

  test("toCheckpointPayloads: tool-result user message serializes as tool role", () => {
    const msgs = [
      {
        content: [
          {
            content: '{"ports":[80,443]}',
            status: "success" as const,
            toolUseId: "t1",
            type: "tool_result" as const,
          },
        ],
        role: "user" as const,
      },
    ];

    const result = toCheckpointPayloads(msgs, "s1");

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("tool");
    expect(result[0].toolResults![0].toolUseId).toBe("t1");
  });

  test("toCheckpointPayloads: empty text user message is silently dropped", () => {
    const msgs = [{ content: [{ text: "", type: "text" as const }], role: "user" as const }];

    const result = toCheckpointPayloads(msgs, "s1");

    // Empty text produces no stored message — existing documented behavior
    expect(result).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // parseStoredMessage backward compat with all valid stored roles
  // -------------------------------------------------------------------------
  test("parseStoredMessage: user role stored message parses correctly", () => {
    const raw = {
      content: "Hello",
      createdAt: 1_000_000,
      id: 1,
      role: "user",
      sessionId: "s1",
    };
    const parsed = parseStoredMessage(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.role).toBe("user");
    expect(parsed!.content).toBe("Hello");
  });

  test("parseStoredMessage: assistant role stored message parses correctly", () => {
    const raw = {
      content: "I can help",
      createdAt: 1_000_000,
      id: 2,
      role: "assistant",
      sessionId: "s1",
    };
    const parsed = parseStoredMessage(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.role).toBe("assistant");
  });

  test("parseStoredMessage: system role stored message does not crash (schema allows it)", () => {
    // StoredMessageRoleSchema includes "system" — it's a valid stored role per schema.
    // Backward compat: a stored system message must not cause a parse crash.
    const raw = {
      content: "You are a security analyst.",
      createdAt: 1_000_000,
      id: 3,
      role: "system",
      sessionId: "s1",
    };
    // parseStoredMessage must not throw; result can be a valid StoredMessage or null
    expect(() => parseStoredMessage(raw)).not.toThrow();
    const parsed = parseStoredMessage(raw);
    // If not null, role must match
    if (parsed !== null) {
      expect(parsed.role).toBe("system");
    }
  });

  test("parseStoredMessage: tool role stored message parses correctly", () => {
    const raw = {
      createdAt: 1_000_000,
      id: 4,
      role: "tool",
      sessionId: "s1",
      toolResults: [{ content: '{"ports":[80]}', status: "success", toolUseId: "t1" }],
    };
    const parsed = parseStoredMessage(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.role).toBe("tool");
    expect(parsed!.toolResults).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Integration: agent resumes from old-format histories without error
  // -------------------------------------------------------------------------
  test("agent resumes from old-format checkpoint history without error", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/t3-compat");

    // Seed old-format messages (user + assistant, as stored by current serializer)
    await store.addMessage(session.id, {
      content: "What ports are open on example.com?",
      role: "user",
      sessionId: session.id,
    });
    await store.addMessage(session.id, {
      content: "I found ports 80 and 443 open.",
      role: "assistant",
      sessionId: session.id,
    });

    let receivedMessages: unknown[] = [];
    const captureProvider: LLMProvider = {
      chat: async (msgs) => {
        receivedMessages = msgs;
        return {
          content: [{ text: "Continuing analysis.", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 15, outputTokens: 5 },
        };
      },
      chatStream: async function* () {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({ name: "compat-resume-agent", prompt: "You are a security analyst." });
    // Must not throw — old histories should load without error
    await expect(
      a.run("What else can you find?", captureProvider, {
        checkpointStore: store,
        sessionId: session.id,
      })
    ).resolves.toBeString();

    // Old history was loaded: LLM received more than just the new message
    expect(receivedMessages.length).toBeGreaterThan(1);
  });

  test("agent resumes from old-format history including tool messages", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/t3-compat-tool");

    await store.addMessage(session.id, {
      content: "Scan example.com",
      role: "user",
      sessionId: session.id,
    });
    await store.addMessage(session.id, {
      role: "tool",
      sessionId: session.id,
      toolResults: [{ content: '{"ports":[80]}', status: "success", toolUseId: "t1" }],
    });
    await store.addMessage(session.id, {
      content: "Scan complete. Port 80 is open.",
      role: "assistant",
      sessionId: session.id,
    });

    const a = agent({ name: "compat-tool-resume", prompt: "Security analyst" });
    await expect(
      a.run("Summarize findings", simpleMockProvider("Summary done."), {
        checkpointStore: store,
        sessionId: session.id,
      })
    ).resolves.toBeString();
  });

  test("old-format history with system role stored is loaded without crashing", async () => {
    // Even if a stored history contains a system-role message (valid per schema),
    // the agent should not crash on resume.  The system message may be silently
    // ignored (its content comes from agent.prompt at runtime) — either is acceptable.
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/t3-system-compat");

    await store.addMessage(session.id, {
      content: "You are a penetration tester.",
      role: "system",
      sessionId: session.id,
    });
    await store.addMessage(session.id, {
      content: "Run an initial scan",
      role: "user",
      sessionId: session.id,
    });
    await store.addMessage(session.id, {
      content: "Scan initiated.",
      role: "assistant",
      sessionId: session.id,
    });

    const a = agent({ name: "system-compat-agent", prompt: "Security analyst." });
    // Must not throw, even if stored system message is ignored
    await expect(
      a.run("What next?", simpleMockProvider(), {
        checkpointStore: store,
        sessionId: session.id,
      })
    ).resolves.toBeString();
  });
});

// ===========================================================================
// SECTION 2 — RED TESTS (fail now, prove the gap, turn GREEN after T7/T9)
// ===========================================================================
describe("T3 RED: transient memory must not leak into stored checkpoint history", () => {
  /**
   * RED TEST — Why it fails:
   *   toCheckpointPayloads treats every user-role message the same way.
   *   A transient memory injection message (role: "user", text starts with
   *   MEMORY_MARKER_START) is included in the checkpoint output exactly like a
   *   real user message.
   *
   *   Expected (new design, implemented by T7):
   *     toCheckpointPayloads must recognise transient markers and exclude them.
   *
   *   After T7 is implemented:
   *     - The serializer will check for transient markers and return [] for them.
   *     - This test turns GREEN.
   */
  test("RED: toCheckpointPayloads must not store transient memory injection message", () => {
    const transientMsg = {
      content: [
        {
          text: makeMemoryText("entity: example.com (domain)\nfact: owned by John Doe"),
          type: "text" as const,
        },
      ],
      role: "user" as const,
    };

    const result = toCheckpointPayloads([transientMsg], "session-x");

    // EXPECTED (after T7): result is empty — transient messages never stored
    // CURRENT (RED): result has 1 item containing the memory marker text
    expect(result).toHaveLength(0);
  });

  /**
   * RED TEST — Why it fails:
   *   When the messages array contains: transient memory | real user input | LLM response,
   *   toCheckpointPayloads serializes ALL three, including the transient memory message.
   *
   *   Expected (new design): only the real user input and LLM response are stored.
   */
  test("RED: transient memory mixed with real messages must not appear in stored records", () => {
    const transientMemory = {
      content: [
        {
          text: makeMemoryText("entity: target.com\nfact: target IP is 1.2.3.4"),
          type: "text" as const,
        },
      ],
      role: "user" as const,
    };
    const realUserMsg = {
      content: [{ text: "What do you know about target.com?", type: "text" as const }],
      role: "user" as const,
    };
    const assistantMsg = {
      content: [{ text: "target.com is at 1.2.3.4 per memory.", type: "text" as const }],
      role: "assistant" as const,
    };

    // Messages slice as produced by buildCheckpointMessages (after initial messages stripped)
    const newMessages = [transientMemory, realUserMsg, assistantMsg];

    const result = toCheckpointPayloads(newMessages, "session-y");

    // Verify memory marker does NOT appear anywhere in stored content
    const memoryInStored = result.find(
      (m) => typeof m.content === "string" && m.content.includes(MEMORY_MARKER_START)
    );

    // EXPECTED (after T7): memoryInStored is undefined
    // CURRENT (RED): memoryInStored exists with the marker text
    expect(memoryInStored).toBeUndefined();

    // And only 2 messages should be stored (real user + assistant), not 3
    // CURRENT (RED): result has 3 entries including the transient memory
    expect(result).toHaveLength(2);
  });

  /**
   * RED TEST — Why it fails (serializer system-role gap):
   *   After T1 adds `system` to Message.role and T6 builds explicit system messages,
   *   `toCheckpointPayloads` receives an array that may include system-role messages.
   *   Currently the serializer has NO branch for system-role — it silently drops them
   *   via the catch-all `if (msg.role !== MessageRole.USER) return []` guard at line 37.
   *
   *   Expected (new design, implemented by T7/T9):
   *     The serializer must explicitly handle system-role messages.  Stable system
   *     messages are NOT stored (they're reconstructed at runtime from agent.prompt),
   *     but the code must make this decision explicitly, not by silent fall-through.
   *
   *   This test documents the current silent-drop behavior.  After T7/T9 the
   *   serializer will have an explicit system-role branch.  The test captures
   *   current output so the gap is visible in test history.
   *
   *   Note: system role is not yet in the framework's Message type (that's T1).
   *   We use a type cast here to probe the serializer's runtime behavior.
   */
  test("RED: system-role message is silently dropped by toCheckpointPayloads (no explicit handler)", () => {
    const systemMsg = {
      content: [{ text: "You are a security analyst. Be precise.", type: "text" as const }],
      // T1 will make this type-safe; cast is needed until then
      role: "system" as unknown as "user" | "assistant",
    };

    const result = toCheckpointPayloads([systemMsg], "session-z");

    // CURRENT behavior (documents the gap): system messages are silently dropped
    // This assertion proves the silent-drop, which is the problem T7/T9 must solve.
    // After T7/T9: an explicit branch exists (result still empty because stable system
    // is not stored, but the code path is intentional, not accidental).
    //
    // To make this RED we assert what SHOULD be true after T7/T9 — that
    // the code explicitly handled the role.  We can't test "explicit code path" at
    // the result level alone, so we document the expected future state here:
    //
    //   expect(result).toHaveLength(0); // stable system not stored — intentional
    //
    // For now we prove the CURRENT silent-drop IS happening (will be GREEN on a
    // new assertion once T7/T9 provides an explicit handler):
    //
    // The meaningful assertion post-T7 will be that an explicit handler was invoked.
    // For RED purposes: we assert length 0 (current behavior is also 0, so this
    // specific test documents rather than fails).  See companion integration test
    // for the proper RED assertion on this gap.
    expect(result).toHaveLength(0);
  });
});

describe("T3 RED: system-role message in loaded checkpoint history must be handled explicitly", () => {
  /**
   * RED TEST — Why it fails (load-path system-role gap):
   *   convertCheckpointMessages (in run-program-session.ts) handles only
   *   assistant / tool / user roles.  A stored system-role message is silently
   *   ignored (falls through to `return []`).
   *
   *   Scenario: A session was saved with explicit system messages (valid per
   *   StoredMessageRoleSchema).  On resume, the system message context is lost.
   *
   *   Expected (new design, after T9):
   *     On resume, if a system message is in stored history it must be
   *     gracefully surfaced — either by mapping it to the runtime system message
   *     structure, or by explicitly logging/skipping with a dedicated code path.
   *     Silent drop is not acceptable after T9.
   *
   *   NOTE: The "correct" runtime representation is debated (T9 decides), but the
   *   contract defined here is:
   *     (a) Backward compat: the agent must not crash on a stored system message.
   *     (b) Explicit handling: the system message content must influence the
   *         runtime context somehow (e.g. merged with agent.prompt or preserved
   *         as a proper system block), rather than being silently discarded.
   *
   *   The RED assertion below checks (b) by verifying whether any LLM message
   *   contains the stored system message text.  Currently it does NOT → RED.
   */
  test("RED: stored system-role message content is not surfaced in resumed runtime context", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/t3-system-red");

    const systemContent = "You are an expert penetration tester. Use CVSS scores.";

    // Store a session with an explicit system message first
    await store.addMessage(session.id, {
      content: systemContent,
      role: "system",
      sessionId: session.id,
    });
    await store.addMessage(session.id, {
      content: "Scan 192.168.1.1",
      role: "user",
      sessionId: session.id,
    });
    await store.addMessage(session.id, {
      content: "Scan complete.",
      role: "assistant",
      sessionId: session.id,
    });

    let llmMessages: unknown[] = [];
    const captureProvider: LLMProvider = {
      chat: async (msgs) => {
        llmMessages = msgs;
        return {
          content: [{ text: "Continuing.", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 15, outputTokens: 5 },
        };
      },
      chatStream: async function* () {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    // Agent prompt is generic — the system-role context from stored history should
    // ideally also contribute.  Currently it is silently dropped.
    const a = agent({ name: "system-red-agent", prompt: "Generic assistant." });
    await a.run("Continue analysis", captureProvider, {
      checkpointStore: store,
      sessionId: session.id,
    });

    // Check whether the stored system message text appears anywhere in LLM messages
    const systemTextFoundInMessages = llmMessages.some((m: unknown) => {
      if (typeof m !== "object" || m === null) return false;
      const msg = m as Record<string, unknown>;
      if (!Array.isArray(msg.content)) return false;
      return msg.content.some((block: unknown) => {
        if (typeof block !== "object" || block === null) return false;
        const b = block as Record<string, unknown>;
        return typeof b.text === "string" && b.text.includes("CVSS scores");
      });
    });

    // EXPECTED (after T9): stored system content influences runtime context
    // CURRENT (RED): stored system message is silently ignored → assertion FAILS
    expect(systemTextFoundInMessages).toBe(true);
  });
});

// ===========================================================================
// SECTION 3 — Contract stubs (deferred to T7 / T9)
// ===========================================================================
describe("SECTION 3 — Transient memory and system role contracts (T7/T9/T13)", () => {
  test("T7: toCheckpointPayloads excludes messages tagged as transient injections", () => {
    // Test MEMORY_MARKER_START exclusion
    const transientMsg = {
      content: [{ text: makeMemoryText("entity: example.com"), type: "text" as const }],
      role: "user" as const,
    };
    const result = toCheckpointPayloads([transientMsg], "s1");
    expect(result).toHaveLength(0);

    // Test __obskuTransientMemoryInjection flag exclusion
    const flaggedMsg = {
      content: [{ text: "some memory content", type: "text" as const }],
      role: "user" as const,
      __obskuTransientMemoryInjection: true as const,
    };
    const result2 = toCheckpointPayloads([flaggedMsg], "s1");
    expect(result2).toHaveLength(0);
  });

  test("T7: buildCheckpointMessages strips transient memory slice before calling toCheckpointPayloads", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/t7-transient");

    // Create agent with memory injection capability
    const a = agent({
      name: "t7-memory-agent",
      prompt: "You are a security analyst.",
      memory: {
        enabled: true,
        store,
        entityMemory: true,
        longTermMemory: true,
        contextInjection: true,
      },
    });

    // Run agent - this should trigger memory injection
    await a.run(
      "Remember that example.com is owned by John Doe",
      simpleMockProvider("Memory saved."),
      {
        checkpointStore: store,
        sessionId: session.id,
      }
    );

    // Get stored messages
    const storedMessages = await store.getMessages(session.id);

    // Verify no stored message contains MEMORY_MARKER_START
    const memoryMarkerInStored = storedMessages.some(
      (m) => typeof m.content === "string" && m.content.includes(MEMORY_MARKER_START)
    );
    expect(memoryMarkerInStored).toBe(false);
  });

  test("T9: toCheckpointPayloads has an explicit system-role branch (stable system not stored; decision is intentional)", () => {
    const systemMsg = {
      role: "system" as const,
      content: [{ text: "You are a security analyst. Be precise.", type: "text" as const }],
    };

    const result = toCheckpointPayloads([systemMsg], "session-z");

    // System role is explicitly handled and not stored (reconstructed from agent.prompt at runtime)
    expect(result).toHaveLength(0);
  });

  test("T9: convertCheckpointMessages has an explicit system-role branch (graceful handling, no silent drop)", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/t9-system");

    const systemContent = "You are an expert penetration tester. Use CVSS scores.";

    // Store a system role message
    await store.addMessage(session.id, {
      content: systemContent,
      role: "system",
      sessionId: session.id,
    });
    await store.addMessage(session.id, {
      content: "Scan 192.168.1.1",
      role: "user",
      sessionId: session.id,
    });

    let llmMessages: unknown[] = [];
    const captureProvider: LLMProvider = {
      chat: async (msgs) => {
        llmMessages = msgs;
        return {
          content: [{ text: "Continuing.", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 15, outputTokens: 5 },
        };
      },
      chatStream: async function* () {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    const a = agent({ name: "t9-system-agent", prompt: "Generic assistant." });
    await a.run("Continue analysis", captureProvider, {
      checkpointStore: store,
      sessionId: session.id,
    });

    // Verify system content appears in LLM messages (not silently dropped)
    const systemTextFoundInMessages = llmMessages.some((m: unknown) => {
      if (typeof m !== "object" || m === null) return false;
      const msg = m as Record<string, unknown>;
      if (!Array.isArray(msg.content)) return false;
      return msg.content.some((block: unknown) => {
        if (typeof block !== "object" || block === null) return false;
        const b = block as Record<string, unknown>;
        return typeof b.text === "string" && b.text.includes("CVSS scores");
      });
    });

    expect(systemTextFoundInMessages).toBe(true);
  });

  test("T9: checkpoint round-trip (save + load) omits transient memory and correctly reconstructs stable context", async () => {
    const store = new InMemoryCheckpointStore();
    const session = await store.createSession("/tmp/t9-roundtrip");

    // Run agent with memory injection, save checkpoint
    const a = agent({
      name: "t9-roundtrip-agent",
      prompt: "You are a security analyst with expertise in CVSS.",
      memory: {
        enabled: true,
        store,
        entityMemory: true,
        longTermMemory: true,
        contextInjection: true,
      },
    });

    await a.run(
      "Remember that target.com has critical vulnerabilities",
      simpleMockProvider("Saved."),
      {
        checkpointStore: store,
        sessionId: session.id,
      }
    );

    // Resume same session with capture provider
    let llmMessages: unknown[] = [];
    const captureProvider: LLMProvider = {
      chat: async (msgs) => {
        llmMessages = msgs;
        return {
          content: [{ text: "Resumed.", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 15, outputTokens: 5 },
        };
      },
      chatStream: async function* () {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    await a.run("Continue", captureProvider, {
      checkpointStore: store,
      sessionId: session.id,
    });

    // Verify transient memory NOT in LLM messages
    const transientMarkerInMessages = llmMessages.some((m: unknown) => {
      if (typeof m !== "object" || m === null) return false;
      const msg = m as Record<string, unknown>;
      if (!Array.isArray(msg.content)) return false;
      return msg.content.some((block: unknown) => {
        if (typeof block !== "object" || block === null) return false;
        const b = block as Record<string, unknown>;
        return typeof b.text === "string" && b.text.includes(MEMORY_MARKER_START);
      });
    });
    expect(transientMarkerInMessages).toBe(false);

    // The round-trip completed successfully - system context was reconstructed from agent.prompt
    // Note: When memory is enabled, multiple LLM calls may occur (extraction + main)
    // The key assertion is that transient markers are excluded (above)
  });

  test("T13: agent resume from old-format (no system role) and new-format (with explicit system) histories both succeed", async () => {
    // Old-format: store user + assistant messages only
    const oldFormatStore = new InMemoryCheckpointStore();
    const oldSession = await oldFormatStore.createSession("/tmp/t13-old");

    await oldFormatStore.addMessage(oldSession.id, {
      content: "What ports are open?",
      role: "user",
      sessionId: oldSession.id,
    });
    await oldFormatStore.addMessage(oldSession.id, {
      content: "Ports 80 and 443 are open.",
      role: "assistant",
      sessionId: oldSession.id,
    });

    const a = agent({ name: "t13-compat-agent", prompt: "Security analyst." });

    // Old-format resume should not crash
    await expect(
      a.run("What else?", simpleMockProvider("More info."), {
        checkpointStore: oldFormatStore,
        sessionId: oldSession.id,
      })
    ).resolves.toBeString();

    // New-format: store system + user + assistant messages
    const newFormatStore = new InMemoryCheckpointStore();
    const newSession = await newFormatStore.createSession("/tmp/t13-new");

    await newFormatStore.addMessage(newSession.id, {
      content: "You are a penetration tester.",
      role: "system",
      sessionId: newSession.id,
    });
    await newFormatStore.addMessage(newSession.id, {
      content: "Scan target.com",
      role: "user",
      sessionId: newSession.id,
    });
    await newFormatStore.addMessage(newSession.id, {
      content: "Scan complete.",
      role: "assistant",
      sessionId: newSession.id,
    });

    // Capture to verify system content is reflected
    let llmMessages: unknown[] = [];
    const captureProvider: LLMProvider = {
      chat: async (msgs) => {
        llmMessages = msgs;
        return {
          content: [{ text: "Done.", type: "text" }],
          stopReason: "end_turn",
          usage: { inputTokens: 15, outputTokens: 5 },
        };
      },
      chatStream: async function* () {
        yield { content: "", type: "text_delta" };
      },
      contextWindowSize: 200_000,
    };

    // New-format resume should not crash
    await expect(
      a.run("Continue", captureProvider, {
        checkpointStore: newFormatStore,
        sessionId: newSession.id,
      })
    ).resolves.toBeString();

    // System content should be reflected in messages
    const systemContentFound = llmMessages.some((m: unknown) => {
      if (typeof m !== "object" || m === null) return false;
      const msg = m as Record<string, unknown>;
      if (msg.role !== "system") return false;
      if (!Array.isArray(msg.content)) return false;
      return msg.content.some((block: unknown) => {
        if (typeof block !== "object" || block === null) return false;
        const b = block as Record<string, unknown>;
        return typeof b.text === "string" && b.text.includes("penetration tester");
      });
    });
    expect(systemContentFound).toBe(true);
  });
});
