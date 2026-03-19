import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentEvent } from "../../src/types";
import { defaultConfig, makeEmit, makeProvider } from "../utils/helpers";
import { runReactLoop } from "../utils/loop-helpers";
import { textResponse } from "../utils/responses";

describe("agent event emissions", () => {
  test("emits PlannerThinking with text content", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeProvider(async () => textResponse("I will analyze this request"));

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events)
      )
    );

    const thinkingEvents = events.filter((e) => e.type === "agent.thinking");
    expect(thinkingEvents).toHaveLength(1);
    expect(thinkingEvents[0]).toMatchObject({
      content: "I will analyze this request",
      type: "agent.thinking",
    });
    expect(thinkingEvents[0].timestamp).toBeGreaterThan(0);
  });

  test("emits AgentTransition Executing to Done before Complete", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeProvider(async () => textResponse("Task complete"));

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events)
      )
    );

    const transitionEvents = events.filter((e) => e.type === "agent.transition");
    const doneTransition = transitionEvents.find(
      (e) =>
        (e as { from: string; to: string }).from === "Executing" &&
        (e as { from: string; to: string }).to === "Done"
    );

    expect(doneTransition).toBeDefined();
    expect(doneTransition).toMatchObject({
      from: "Executing",
      to: "Done",
      type: "agent.transition",
    });
    expect(doneTransition!.timestamp).toBeGreaterThan(0);

    const completeEventIndex = events.findIndex((e) => e.type === "agent.complete");
    const doneTransitionIndex = events.findIndex(
      (e) =>
        e.type === "agent.transition" &&
        (e as { from: string; to: string }).from === "Executing" &&
        (e as { from: string; to: string }).to === "Done"
    );
    expect(doneTransitionIndex).toBeLessThan(completeEventIndex);
  });

  test("emits correct event sequence for successful run", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeProvider(async () => textResponse("Success"));

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events)
      )
    );

    const plannerThinking = events.find((e) => e.type === "agent.thinking");
    const execToDone = events.find(
      (e) =>
        e.type === "agent.transition" &&
        (e as { from: string; to: string }).from === "Executing" &&
        (e as { from: string; to: string }).to === "Done"
    );
    const complete = events.find((e) => e.type === "agent.complete");

    expect(plannerThinking).toBeDefined();
    expect(execToDone).toBeDefined();
    expect(complete).toBeDefined();

    expect(events.indexOf(plannerThinking!)).toBeLessThan(events.indexOf(execToDone!));
    expect(events.indexOf(execToDone!)).toBeLessThan(events.indexOf(complete!));
  });

  test("emits Complete event with summary", async () => {
    const events: Array<AgentEvent> = [];
    const provider = makeProvider(async () => textResponse("Final result"));

    await Effect.runPromise(
      runReactLoop(
        [{ content: [{ text: "hi", type: "text" }], role: "user" }],
        [],
        new Map(),
        provider,
        defaultConfig,
        new Set(),
        undefined,
        makeEmit(events)
      )
    );

    const completeEvents = events.filter((e) => e.type === "agent.complete");
    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0]).toMatchObject({
      summary: "Final result",
      type: "agent.complete",
    });
    expect(completeEvents[0].timestamp).toBeGreaterThan(0);
  });
});
