import crypto from "node:crypto";
import { DEFAULTS } from "../defaults";
import type { AgentEvent } from "../types";
import { formatError } from "../utils";
import { TaskConcurrencyError } from "./errors";

export type TaskState = "pending" | "running" | "completed" | "failed" | "timeout";

export interface TaskEntry {
  completedAt?: number;
  error?: string;
  id: string;
  pluginName: string;
  result?: unknown;
  startedAt: number;
  state: TaskState;
}

export interface TaskManagerConfig {
  maxConcurrent: number;
  maxLifetimeMs: number;
  onEvent?: (event: AgentEvent) => void;
  retentionMs: number;
}

const DEFAULT_CONFIG: TaskManagerConfig = {
  maxConcurrent: 10,
  maxLifetimeMs: DEFAULTS.taskMaxLifetime,
  retentionMs: DEFAULTS.taskRetention,
};

export class TaskManager {
  readonly config: TaskManagerConfig;
  private tasks = new Map<string, TaskEntry>();

  constructor(config: Partial<TaskManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private get runningCount(): number {
    let count = 0;
    for (const t of this.tasks.values()) {
      if (t.state === "running") {
        count++;
      }
    }
    return count;
  }

  start(pluginName: string, fn: () => Promise<unknown>): string {
    if (this.runningCount >= this.config.maxConcurrent) {
      throw new TaskConcurrencyError(this.config.maxConcurrent);
    }

    const id = `task-${crypto.randomUUID().slice(0, DEFAULTS.preview.shortIdLength)}`;

    const entry: TaskEntry = {
      id,
      pluginName,
      startedAt: Date.now(),
      state: "running",
    };
    this.tasks.set(id, entry);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Task timeout")), this.config.maxLifetimeMs)
    );

    Promise.race([fn(), timeoutPromise]).then(
      (result) => {
        const completedAt = Date.now();
        entry.state = "completed";
        entry.result = result;
        entry.completedAt = completedAt;
        this.config.onEvent?.({
          duration: completedAt - entry.startedAt,
          taskId: id,
          timestamp: completedAt,
          toolName: pluginName,
          type: "bg.task.completed",
        });
      },
      (error) => {
        const completedAt = Date.now();
        const isTimeout = error instanceof Error && error.message === "Task timeout";
        entry.state = isTimeout ? "timeout" : "failed";
        entry.error = formatError(error);
        entry.completedAt = completedAt;
        if (isTimeout) {
          this.config.onEvent?.({
            taskId: id,
            timestamp: completedAt,
            toolName: pluginName,
            type: "bg.task.timeout",
          });
        } else {
          this.config.onEvent?.({
            error: formatError(error),
            taskId: id,
            timestamp: completedAt,
            toolName: pluginName,
            type: "bg.task.failed",
          });
        }
      }
    );

    return id;
  }

  getResult(taskId: string): TaskEntry | undefined {
    return this.tasks.get(taskId);
  }

  getCompletedSince(timestamp: number): Array<TaskEntry> {
    const results: Array<TaskEntry> = [];
    for (const t of this.tasks.values()) {
      if (
        (t.state === "completed" || t.state === "failed" || t.state === "timeout") &&
        t.completedAt !== undefined &&
        t.completedAt >= timestamp
      ) {
        results.push(t);
      }
    }
    return results;
  }

  cleanup(): number {
    const cutoff = Date.now() - this.config.retentionMs;
    let removed = 0;
    for (const [id, t] of this.tasks.entries()) {
      if (
        (t.state === "completed" || t.state === "failed" || t.state === "timeout") &&
        t.completedAt !== undefined &&
        t.completedAt < cutoff
      ) {
        this.tasks.delete(id);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.tasks.size;
  }
}
