import { beforeEach, describe, expect, test } from "bun:test";
import { TaskManager } from "../../src/background";
import type { AgentEvent } from "../../src/types";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("bg.task.* events", () => {
  let events: Array<AgentEvent> = [];

  beforeEach(() => {
    events = [];
  });

  function createTaskManager(config?: { maxLifetimeMs?: number }): TaskManager {
    return new TaskManager({
      ...config,
      onEvent: (event) => events.push(event),
    });
  }

  test("emits bg.task.completed when task succeeds", async () => {
    const tm = createTaskManager();
    tm.start("test-plugin", async () => "success-result");

    await delay(20);

    const completedEvents = events.filter((e) => e.type === "bg.task.completed");
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]).toMatchObject({
      toolName: "test-plugin",
      type: "bg.task.completed",
    });
    expect(completedEvents[0].taskId).toMatch(/^task-[a-f0-9]{8}$/);
    expect(completedEvents[0].duration).toBeGreaterThanOrEqual(0);
    expect(completedEvents[0].timestamp).toBeGreaterThan(0);
  });

  test("emits bg.task.failed when task throws", async () => {
    const tm = createTaskManager();
    tm.start("failing-plugin", async () => {
      throw new Error("task-failed-error");
    });

    await delay(20);

    const failedEvents = events.filter((e) => e.type === "bg.task.failed");
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0]).toMatchObject({
      error: "task-failed-error",
      toolName: "failing-plugin",
      type: "bg.task.failed",
    });
    expect(failedEvents[0].taskId).toMatch(/^task-[a-f0-9]{8}$/);
    expect(failedEvents[0].timestamp).toBeGreaterThan(0);
  });

  test("emits bg.task.timeout when task exceeds maxLifetimeMs", async () => {
    const tm = createTaskManager({ maxLifetimeMs: 50 });
    tm.start("slow-plugin", () => delay(500).then(() => "late-result"));

    await delay(100);

    const timeoutEvents = events.filter((e) => e.type === "bg.task.timeout");
    expect(timeoutEvents).toHaveLength(1);
    expect(timeoutEvents[0]).toMatchObject({
      toolName: "slow-plugin",
      type: "bg.task.timeout",
    });
    expect(timeoutEvents[0].taskId).toMatch(/^task-[a-f0-9]{8}$/);
    expect(timeoutEvents[0].timestamp).toBeGreaterThan(0);
  });

  test("does not emit completed event for timed out task", async () => {
    const tm = createTaskManager({ maxLifetimeMs: 50 });
    tm.start("slow-plugin", () => delay(500).then(() => "late-result"));

    await delay(100);

    const completedEvents = events.filter((e) => e.type === "bg.task.completed");
    expect(completedEvents).toHaveLength(0);
  });

  test("emits correct event for each task independently", async () => {
    const tm = createTaskManager();

    tm.start("success-plugin", async () => "ok");
    tm.start("fail-plugin", async () => {
      throw new Error("fail");
    });

    await delay(20);

    expect(events).toHaveLength(2);

    const completedEvents = events.filter((e) => e.type === "bg.task.completed");
    const failedEvents = events.filter((e) => e.type === "bg.task.failed");

    expect(completedEvents).toHaveLength(1);
    expect(failedEvents).toHaveLength(1);
    expect(completedEvents[0].toolName).toBe("success-plugin");
    expect(failedEvents[0].toolName).toBe("fail-plugin");
  });

  test("completed event includes correct duration", async () => {
    const tm = createTaskManager();
    tm.start("slow-success", async () => {
      await delay(50);
      return "done";
    });

    await delay(80);

    const completedEvents = events.filter((e) => e.type === "bg.task.completed");
    expect(completedEvents[0].duration).toBeGreaterThanOrEqual(50);
  });

  test("failed event includes error message for non-Error throws", async () => {
    const tm = createTaskManager();
    tm.start("string-throw", async () => {
      throw "string-error";
    });

    await delay(20);

    const failedEvents = events.filter((e) => e.type === "bg.task.failed");
    expect(failedEvents[0].error).toBe("string-error");
  });
});
