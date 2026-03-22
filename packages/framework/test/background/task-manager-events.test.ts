import { beforeEach, describe, expect, test } from "bun:test";
import { TaskManager } from "../../src/background";
import type { DefaultPublicPayload } from "../../src/output-policy";
import type { AgentEvent } from "../../src/types";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor<T>(getValue: () => T | undefined, timeoutMs = 500): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = getValue();
    if (value !== undefined) {
      return value;
    }
    await delay(10);
  }

  throw new Error("timed out waiting for value");
}

describe("bg.task.* events", () => {
  let events: Array<DefaultPublicPayload<AgentEvent>> = [];

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

    const completedEvents = events.filter(
      (e): e is DefaultPublicPayload<Extract<AgentEvent, { type: "bg.task.completed" }>> =>
        e.type === "bg.task.completed"
    );
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]).toMatchObject({
      data: { toolName: "test-plugin" },
      type: "bg.task.completed",
    });
    expect(completedEvents[0].data.taskId).toMatch(/^task-[a-f0-9]{8}$/);
    expect(completedEvents[0].data.duration).toBeGreaterThanOrEqual(0);
    expect(completedEvents[0].timestamp).toBeGreaterThan(0);
  });

  test("emits bg.task.failed when task throws", async () => {
    const tm = createTaskManager();
    tm.start("failing-plugin", async () => {
      throw new Error("task-failed-error");
    });

    await delay(20);

    const failedEvents = events.filter(
      (e): e is DefaultPublicPayload<Extract<AgentEvent, { type: "bg.task.failed" }>> =>
        e.type === "bg.task.failed"
    );
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0]).toMatchObject({
      data: { error: "task-failed-error", toolName: "failing-plugin" },
      type: "bg.task.failed",
    });
    expect(failedEvents[0].data.taskId).toMatch(/^task-[a-f0-9]{8}$/);
    expect(failedEvents[0].timestamp).toBeGreaterThan(0);
  });

  test("emits bg.task.timeout when task exceeds maxLifetimeMs", async () => {
    const tm = createTaskManager({ maxLifetimeMs: 50 });
    tm.start("slow-plugin", () => delay(500).then(() => "late-result"));

    await delay(100);

    const timeoutEvents = events.filter(
      (e): e is DefaultPublicPayload<Extract<AgentEvent, { type: "bg.task.timeout" }>> =>
        e.type === "bg.task.timeout"
    );
    expect(timeoutEvents).toHaveLength(1);
    expect(timeoutEvents[0]).toMatchObject({
      data: { toolName: "slow-plugin" },
      type: "bg.task.timeout",
    });
    expect(timeoutEvents[0].data.taskId).toMatch(/^task-[a-f0-9]{8}$/);
    expect(timeoutEvents[0].timestamp).toBeGreaterThan(0);
  });

  test("does not emit completed event for timed out task", async () => {
    const tm = createTaskManager({ maxLifetimeMs: 50 });
    tm.start("slow-plugin", () => delay(500).then(() => "late-result"));

    await delay(100);

    const completedEvents = events.filter(
      (e): e is DefaultPublicPayload<Extract<AgentEvent, { type: "bg.task.completed" }>> =>
        e.type === "bg.task.completed"
    );
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

    const completedEvents = events.filter(
      (e): e is DefaultPublicPayload<Extract<AgentEvent, { type: "bg.task.completed" }>> =>
        e.type === "bg.task.completed"
    );
    const failedEvents = events.filter(
      (e): e is DefaultPublicPayload<Extract<AgentEvent, { type: "bg.task.failed" }>> =>
        e.type === "bg.task.failed"
    );

    expect(completedEvents).toHaveLength(1);
    expect(failedEvents).toHaveLength(1);
    expect(completedEvents[0].data.toolName).toBe("success-plugin");
    expect(failedEvents[0].data.toolName).toBe("fail-plugin");
  });

  test("completed event includes correct duration", async () => {
    const tm = createTaskManager();
    tm.start("slow-success", async () => {
      await delay(50);
      return "done";
    });

    const completedEvent = await waitFor(
      () =>
        events.find(
          (e): e is DefaultPublicPayload<Extract<AgentEvent, { type: "bg.task.completed" }>> =>
            e.type === "bg.task.completed"
        ),
      1_000
    );

    expect(completedEvent.data.duration).toBeGreaterThanOrEqual(50);
  });

  test("failed event includes error message for non-Error throws", async () => {
    const tm = createTaskManager();
    tm.start("string-throw", async () => {
      throw "string-error";
    });

    await delay(20);

    const failedEvents = events.filter(
      (e): e is DefaultPublicPayload<Extract<AgentEvent, { type: "bg.task.failed" }>> =>
        e.type === "bg.task.failed"
    );
    expect(failedEvents[0].data.error).toBe("string-error");
  });
});
